import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AccountRepository } from "../src/accounts/accountRepository.js";
import { SwitchService } from "../src/accounts/switchService.js";
import { LockService } from "../src/accounts/lockService.js";
import { CodexConfigService } from "../src/config/codexConfigService.js";
import { resolvePaths } from "../src/config/paths.js";
import { readStateFile, writeStateFile } from "../src/accounts/accountService.js";
import { readAuthFile } from "../src/accounts/authFile.js";
import { AuthSyncService } from "../src/accounts/authSyncService.js";
import { UsageService } from "../src/usage/usageService.js";
import { extractLoginUrl, SignInService } from "../src/accounts/signInService.js";
import { UsageDatabase } from "../src/usage/database.js";

const auth = (id: string, credential = id) =>
  Buffer.from(JSON.stringify({ tokens: { refresh_token: `fake-${credential}` }, account_id: id }));

test("extracts the Codex login URL from CLI output", () => {
  assert.equal(
    extractLoginUrl("Open https://auth.openai.com/codex/device?code=abc).\u001b[0m"),
    "https://auth.openai.com/codex/device?code=abc",
  );
  assert.equal(
    extractLoginUrl("Open https://chatgpt.com/codex/device?code=abc"),
    "https://chatgpt.com/codex/device?code=abc",
  );
  assert.equal(extractLoginUrl("Open https://auth.openai.com@evil.example/login"), undefined);
  assert.equal(extractLoginUrl("Open https://auth.openai.com.evil.example/login"), undefined);
  assert.equal(extractLoginUrl("Open http://auth.openai.com/codex/device?code=abc"), undefined);
  assert.equal(extractLoginUrl("No sign-in URL"), undefined);
});

test("sign-in stores auth and safe identity metadata with a mocked process", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-signin-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    const process = {
      discover: async () => "/fake/codex",
      run: async (_command: string, _args: readonly string[], options: { cwd?: string }) => {
        await writeFile(
          path.join(options.cwd!, "auth.json"),
          JSON.stringify({
            tokens: { refresh_token: "fake-refresh" },
            email: "personal@example.com",
            account_id: "acct-personal",
          }),
        );
        return { code: 0, signal: null, stdout: "", stderr: "", cancelled: false };
      },
    };
    await new SignInService(repository, paths, process as never).signIn(profile.id, {
      args: ["login"],
    });
    assert.equal(await repository.profileAuthExists(profile.id), true);
    assert.deepEqual((await repository.getProfile(profile.id))?.identity, {
      email: "personal@example.com",
      accountId: "acct-personal",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("account switching remains non-blocking when usage storage fails", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-usage-failure-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    const database = new UsageDatabase(paths.usageDbPath, {
      driver: () => {
        throw new Error("database unavailable");
      },
    });
    let warning: unknown;
    const usage = new UsageService(paths, repository, database, (error) => {
      warning = error;
    });
    await usage.start();
    assert.match(String(warning), /database unavailable/);
    await assert.doesNotReject(() => usage.switchTo(profile.id));
    await usage.stop();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("preserves TOML sections while enabling file auth", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-config-"));
  try {
    const config = path.join(home, "config.toml");
    const before = '# keep\n[mcp_servers.demo]\ncommand = "demo"\n';
    await writeFile(config, before);
    const result = await new CodexConfigService(config).enableFileBackedAuth();
    assert.equal(result.isFileBackedAuthReady, true);
    const after = await readFile(config, "utf8");
    assert.match(after, /cli_auth_credentials_store = "file"/);
    assert.match(after, /\[mcp_servers\.demo\]/);
    assert.match(after, /command = "demo"/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("serializes and releases an exclusive lock", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-lock-"));
  try {
    const lock = new LockService(path.join(home, "switch.lock"));
    const handle = await lock.acquire();
    await assert.rejects(() => lock.acquire(), /already in progress/);
    await handle.release();
    const next = await lock.acquire();
    await next.release();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("clears only a stale lock owned by a dead process", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-stale-lock-"));
  try {
    const lockPath = path.join(home, "switch.lock");
    const lock = new LockService({
      lockPath,
      now: () => Date.parse("2026-01-01T01:00:00.000Z"),
      staleAfterMs: 60_000,
      host: "test-host",
      pid: 42,
      isProcessAlive: () => false,
    });
    await mkdir(home, { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 42,
        host: "test-host",
        createdAt: "2026-01-01T00:00:00.000Z",
        token: "stale",
      }),
    );
    assert.equal(await lock.isStale(), true);
    assert.equal(await lock.clearStale(), true);
    assert.equal(await lock.readInfo(), undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("switches profiles atomically and records selected state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-switch-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const first = await repository.createProfile("First");
    const second = await repository.createProfile("Second");
    await repository.writeProfileAuth(first.id, auth("first"));
    await repository.writeProfileAuth(second.id, auth("second"));
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: first.id,
      selectedProfileSlug: first.slug,
    });
    await writeFile(paths.liveAuthPath, auth("first"));
    const result = await new SwitchService({ repository, paths }).switchTo(second.id);
    assert.equal(result.changed, true);
    assert.equal((await readAuthFile(paths.liveAuthPath)).identity.accountId, "second");
    const state = JSON.parse(await readFile(paths.statePath, "utf8"));
    assert.equal(state.selectedProfileId, second.id);
    assert.equal(await readFile(paths.switchLockPath).catch(() => undefined), undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("releases the switch lock before reloading", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-switch-reload-lock-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const first = await repository.createProfile("First");
    const second = await repository.createProfile("Second");
    await repository.writeProfileAuth(first.id, auth("first"));
    await repository.writeProfileAuth(second.id, auth("second"));
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: first.id,
      selectedProfileSlug: first.slug,
    });
    await writeFile(paths.liveAuthPath, auth("first"));

    await new SwitchService({
      repository,
      paths,
      reload: async () =>
        assert.equal(await readFile(paths.switchLockPath).catch(() => undefined), undefined),
    }).switchTo(second.id);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("replaces stale live auth when the target is already selected", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-switch-stale-live-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const first = await repository.createProfile("First");
    const second = await repository.createProfile("Second");
    await repository.writeProfileAuth(first.id, auth("first"));
    await repository.writeProfileAuth(second.id, auth("second"));
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: second.id,
      selectedProfileSlug: second.slug,
    });
    await writeFile(paths.liveAuthPath, auth("first"));

    const result = await new SwitchService({ repository, paths }).switchTo(second.id);

    assert.equal(result.changed, true);
    assert.equal((await readAuthFile(paths.liveAuthPath)).identity.accountId, "second");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("repairs a known live account before switching", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-switch-repair-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const first = await repository.createProfile("First");
    const second = await repository.createProfile("Second");
    await repository.writeProfileAuth(first.id, auth("first"));
    await repository.writeProfileAuth(second.id, auth("second"));
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: first.id,
      selectedProfileSlug: first.slug,
    });
    await writeFile(paths.liveAuthPath, auth("second"));

    await new SwitchService({ repository, paths }).switchTo(second.id);

    assert.equal((await readStateFile(paths.statePath)).selectedProfileId, second.id);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("keeps the committed switch when reload fails after mutation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-switch-rollback-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const first = await repository.createProfile("First");
    const second = await repository.createProfile("Second");
    await repository.writeProfileAuth(first.id, auth("first"));
    await repository.writeProfileAuth(second.id, auth("second"));
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: first.id,
      selectedProfileSlug: first.slug,
    });
    await writeFile(paths.liveAuthPath, auth("first"));
    await assert.rejects(
      () =>
        new SwitchService({
          repository,
          paths,
          reload: () => {
            throw new Error("reload failed");
          },
        }).switchTo(second.id),
      /reload failed/,
    );
    assert.equal((await readAuthFile(paths.liveAuthPath)).identity.accountId, "second");
    assert.equal((await readStateFile(paths.statePath)).selectedProfileId, second.id);
    assert.equal(await readFile(paths.switchLockPath).catch(() => undefined), undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("syncs selected live auth before the UI reads signed-in state", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-auth-sync-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: profile.id,
      selectedProfileSlug: profile.slug,
    });
    await writeFile(paths.liveAuthPath, auth("personal"));
    const sync = new AuthSyncService(repository, paths);
    await sync.start();
    assert.equal(await repository.profileAuthExists(profile.id), true);
    await sync.stop();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("syncs a refreshed live credential back to the selected profile", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-auth-refresh-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    const oldAuth = auth("personal", "old");
    const refreshed = auth("personal", "new");
    await repository.writeProfileAuth(profile.id, oldAuth);
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: profile.id,
      selectedProfileSlug: profile.slug,
    });
    await writeFile(paths.liveAuthPath, refreshed);
    const result = await new AuthSyncService(repository, paths).syncSelected();
    assert.equal(result.synced, true);
    assert.deepEqual(Buffer.from(await repository.readProfileAuth(profile.id)), refreshed);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("does not sync ambiguous replacement or missing live auth", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-auth-replacement-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    const stored = auth("personal", "stored");
    await repository.writeProfileAuth(profile.id, stored);
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: profile.id,
      selectedProfileSlug: profile.slug,
    });
    await writeFile(paths.liveAuthPath, auth("other"));
    const sync = new AuthSyncService(repository, paths);
    assert.equal((await sync.syncSelected()).reason, "ambiguous-identity");
    assert.deepEqual(Buffer.from(await repository.readProfileAuth(profile.id)), stored);
    await unlink(paths.liveAuthPath);
    assert.equal((await sync.syncSelected()).reason, "missing-live-auth");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("restores the selected auth when Codex replaces the live identity", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-auth-restore-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    const selected = auth("personal");
    await repository.writeProfileAuth(profile.id, selected);
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: profile.id,
      selectedProfileSlug: profile.slug,
    });
    await writeFile(paths.liveAuthPath, auth("other"));

    const result = await new AuthSyncService(repository, paths).syncSelected({
      restoreSelected: true,
    });

    assert.equal(result.restored, true);
    assert.deepEqual(Buffer.from((await readAuthFile(paths.liveAuthPath)).bytes), selected);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("imports existing session usage and records switch intervals after profile sync", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-history-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: profile.id,
      selectedProfileSlug: profile.slug,
    });
    const sessions = path.join(paths.codexHome, "sessions", "2026", "01");
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, "rollout-history.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-01-01T00:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 3 },
            last_token_usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 3 },
          },
        },
      })}\n${JSON.stringify({
        timestamp: "2026-01-01T00:01:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 15, cached_input_tokens: 4, output_tokens: 5 },
          },
        },
      })}\n`,
    );
    const usage = new UsageService(paths, repository);
    await usage.start();
    assert.deepEqual(usage.totals(), {
      inputTokens: 15n,
      cachedInputTokens: 4n,
      uncachedInputTokens: 11n,
      outputTokens: 5n,
      interactions: 2,
    });
    await assert.doesNotReject(() => usage.switchTo(profile.id));
    await usage.stop();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
