import { strict as assert } from "node:assert";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AccountRepository } from "../src/accounts/accountRepository.js";
import { AuthSyncService } from "../src/accounts/authSyncService.js";
import { readStateFile, writeStateFile } from "../src/accounts/accountService.js";
import { resolvePaths, resolveProfilePaths } from "../src/config/paths.js";
import { isUnsupportedPermissionError, securePermissions } from "../src/infra/permissions.js";

const auth = (refreshToken: string) =>
  Buffer.from(JSON.stringify({ tokens: { refresh_token: refreshToken } }));

test("rejects refreshed auth when both identities are unknown", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-security-sync-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    const stored = auth("stored");
    await repository.writeProfileAuth(profile.id, stored);
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: profile.id,
      selectedProfileSlug: profile.slug,
    });
    await mkdir(path.dirname(paths.liveAuthPath), { recursive: true });
    await writeFile(paths.liveAuthPath, auth("replacement"));

    assert.equal(
      (await new AuthSyncService(repository, paths).syncSelected()).reason,
      "ambiguous-identity",
    );
    assert.deepEqual(Buffer.from(await repository.readProfileAuth(profile.id)), stored);
    assert.equal((await readStateFile(paths.statePath)).selectedProfileId, profile.id);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("does not authorize ownership from unsigned JWT claims", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-security-jwt-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    const stored = Buffer.from(
      JSON.stringify({ tokens: { refresh_token: "stored" }, account_id: "account-1" }),
    );
    await repository.writeProfileAuth(profile.id, stored);
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: profile.id,
      selectedProfileSlug: profile.slug,
    });
    const payload = Buffer.from(JSON.stringify({ account_id: "account-1" })).toString("base64url");
    await mkdir(path.dirname(paths.liveAuthPath), { recursive: true });
    await writeFile(
      paths.liveAuthPath,
      JSON.stringify({ tokens: { access_token: `header.${payload}.forged` } }),
    );

    assert.equal(
      (await new AuthSyncService(repository, paths).syncSelected()).reason,
      "ambiguous-identity",
    );
    assert.deepEqual(Buffer.from(await repository.readProfileAuth(profile.id)), stored);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("rejects symlinked profile auth reads and copies", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-security-link-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const profile = await repository.createProfile("Personal");
    const target = path.join(home, "outside-auth.json");
    const authPath = resolveProfilePaths(paths, profile.slug).authPath;
    await writeFile(target, auth("outside"));
    await symlink(target, authPath);

    assert.equal(await repository.profileAuthExists(profile.id), false);
    await assert.rejects(() => repository.readProfileAuth(profile.id), /Invalid profile auth file/);
    await assert.rejects(
      () => repository.copyProfileAuthTo(profile.id, path.join(home, "copy.json")),
      /Invalid profile auth file/,
    );
    assert.equal((await lstat(target)).isFile(), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("verifies restrictive permissions and does not treat EPERM as unsupported", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-security-mode-"));
  try {
    const target = path.join(home, "secret");
    await writeFile(target, "secret", { mode: 0o666 });
    await securePermissions(target, 0o600);
    assert.equal((await lstat(target)).mode & 0o777, 0o600);
    assert.equal(isUnsupportedPermissionError({ code: "EPERM" }), false);
    assert.equal(isUnsupportedPermissionError({ code: "EOPNOTSUPP" }), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
