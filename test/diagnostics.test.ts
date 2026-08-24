import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AccountRepository } from "../src/accounts/accountRepository.js";
import { writeStateFile } from "../src/accounts/accountService.js";
import { DiagnosticsService } from "../src/diagnostics/diagnosticsService.js";
import { Logger, redactSecrets } from "../src/infra/logger.js";
import { resolvePaths } from "../src/config/paths.js";

test("redacts auth and rollout content from logs", () => {
  const refresh = "fake-refresh-token";
  const auth = JSON.stringify({ tokens: { refresh_token: refresh } });
  const rollout = JSON.stringify({ type: "event_msg", payload: { message: "private" } });
  assert.doesNotMatch(redactSecrets(auth), new RegExp(refresh));
  assert.doesNotMatch(redactSecrets(rollout), /private/);

  const lines: string[] = [];
  const logger = new Logger({
    appendLine: (line: string) => lines.push(line),
    dispose() {},
  } as never);
  logger.info("diagnostic", { auth, rollout });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], new RegExp(refresh));
  assert.doesNotMatch(lines[0], /private/);
});

test("collects safe diagnostics without exposing auth contents", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-diagnostics-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    const auth = Buffer.from(
      JSON.stringify({ tokens: { refresh_token: "fake-refresh" }, account_id: "acct-1" }),
    );
    await repository.writeProfileAuth(profile.id, auth);
    await mkdir(path.dirname(paths.liveAuthPath), { recursive: true });
    await writeFile(paths.liveAuthPath, auth);
    await writeFile(paths.configPath, 'cli_auth_credentials_store = "file"\n');
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: profile.id,
      selectedProfileSlug: profile.slug,
    });

    const value = await new DiagnosticsService(paths, {
      cmaVersion: "0.1.0",
      vscodeVersion: "1.102.0",
      codexVersion: "codex-cli test",
    }).collect();
    assert.equal(value.cmaVersion, "0.1.0");
    assert.equal(value.credentialStorageMode, "file");
    assert.equal(value.liveAuthValid, true);
    assert.deepEqual(value.selectedProfile, {
      id: profile.id,
      name: profile.name,
      slug: profile.slug,
    });
    assert.equal(value.liveProfileMatch, true);
    assert.equal(value.switchLock, "clear");
    assert.equal("refresh_token" in value, false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
