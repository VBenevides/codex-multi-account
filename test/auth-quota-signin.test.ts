import { strict as assert } from "node:assert";
import { lstat, mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AccountRepository } from "../src/accounts/accountRepository.js";
import { cleanupLoginStaging, SignInService } from "../src/accounts/signInService.js";
import { writeStateFile } from "../src/accounts/accountService.js";
import { CodexConfigService } from "../src/config/codexConfigService.js";
import { resolvePaths } from "../src/config/paths.js";
import { QuotaService } from "../src/usage/quotaService.js";

const auth = (token: string) =>
  Buffer.from(
    JSON.stringify({ tokens: { access_token: token, refresh_token: `refresh-${token}` } }),
  );

test("requires explicit file-backed auth for every config mode", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-auth-policy-"));
  try {
    const cases = [
      ['cli_auth_credentials_store = "file"\n', true],
      ['cli_auth_credentials_store = "keyring"\n', false],
      ['cli_auth_credentials_store = "auto"\n', false],
      ["", false],
    ] as const;
    for (const [contents, ready] of cases) {
      const config = path.join(home, `${ready}-${contents.length}.toml`);
      await writeFile(config, contents);
      assert.equal(await new CodexConfigService(config).isFileBackedAuthReady(), ready);
    }
    assert.equal(
      await new CodexConfigService(path.join(home, "missing.toml")).isFileBackedAuthReady(),
      false,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("quota requests can be limited to the selected profile", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-quota-policy-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const first = await repository.createProfile("First");
    const second = await repository.createProfile("Second");
    await repository.writeProfileAuth(first.id, auth("first-token"));
    await repository.writeProfileAuth(second.id, auth("second-token"));
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: second.id,
      selectedProfileSlug: second.slug,
    });
    const requests: string[] = [];
    const request: typeof fetch = async (_url, init) => {
      requests.push(new Headers(init?.headers).get("authorization") ?? "");
      return {
        ok: true,
        json: async () => ({ rate_limit: { primary_window: { used_percent: 20 } } }),
      } as Response;
    };

    const quotas = await new QuotaService(repository, request, { policy: "selected" }).list();
    assert.deepEqual(
      quotas.map((quota) => quota.name),
      ["Second"],
    );
    assert.deepEqual(requests, ["Bearer second-token"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("quota network access is disabled unless explicitly enabled", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-quota-disabled-"));
  try {
    const repository = new AccountRepository(resolvePaths(home));
    const profile = await repository.createProfile("Personal");
    await repository.writeProfileAuth(profile.id, auth("personal-token"));
    let requests = 0;
    const request: typeof fetch = async () => {
      requests += 1;
      return { ok: true, json: async () => ({}) } as Response;
    };
    assert.deepEqual(await new QuotaService(repository, request).list(), []);
    assert.equal(requests, 0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("login staging cleanup removes only old abandoned directories", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-staging-cleanup-"));
  try {
    const paths = resolvePaths(home);
    const root = path.join(paths.cmaHome, "login-staging");
    const old = path.join(root, "old");
    const active = path.join(root, "active");
    const fresh = path.join(root, "fresh");
    const symlinkPath = path.join(root, "link");
    await mkdir(root, { recursive: true });
    await Promise.all([mkdir(old), mkdir(active), mkdir(fresh)]);
    await writeFile(path.join(old, "auth.json"), "secret");
    await symlink(old, symlinkPath);
    const now = Date.parse("2026-08-16T12:00:00.000Z");
    await utimes(old, new Date(now - 10_000), new Date(now - 10_000));
    await utimes(active, new Date(now - 10_000), new Date(now - 10_000));
    await cleanupLoginStaging(paths, now, 1_000, new Set([active]));
    await assert.rejects(() => stat(old), { code: "ENOENT" });
    assert.equal((await stat(active)).isDirectory(), true);
    assert.equal((await stat(fresh)).isDirectory(), true);
    assert.equal((await lstat(symlinkPath)).isSymbolicLink(), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("sign-in cleans abandoned staging before starting a new login", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-signin-cleanup-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    const old = path.join(paths.cmaHome, "login-staging", "abandoned");
    await mkdir(old, { recursive: true });
    const now = Date.now();
    await utimes(
      old,
      new Date(now - 2 * 24 * 60 * 60 * 1000),
      new Date(now - 2 * 24 * 60 * 60 * 1000),
    );
    const process = {
      discover: async () => "/fake/codex",
      run: async (_command: string, _args: readonly string[], options: { cwd?: string }) => {
        await writeFile(path.join(options.cwd!, "auth.json"), auth("personal-token"));
        return { code: 0, signal: null, stdout: "", stderr: "", cancelled: false };
      },
    };
    await new SignInService(repository, paths, process as never).signIn(profile.id);
    await assert.rejects(() => stat(old), { code: "ENOENT" });
    assert.equal(await repository.profileAuthExists(profile.id), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
