import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { resolvePaths, resolveProfilePaths } from "../src/config/paths.js";
import { copyFileAtomic, rollbackFile, writeAtomic } from "../src/infra/atomicFile.js";
import {
  parseAccountProfile,
  slugifyProfileName,
  uniqueProfileSlug,
  validateAccountName,
} from "../src/accounts/accountTypes.js";
import { AccountRepository } from "../src/accounts/accountRepository.js";
import { extractAuthIdentity } from "../src/accounts/accountIdentity.js";
import { fingerprintAuth, parseAuthFile } from "../src/accounts/authFile.js";

async function temporaryHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cma-profile-"));
}

test("resolves fixed paths and rejects profile traversal", () => {
  const paths = resolvePaths("/tmp/cma-home");
  assert.equal(paths.liveAuthPath, "/tmp/cma-home/.codex/auth.json");
  assert.equal(
    resolveProfilePaths(paths, "work").authPath,
    "/tmp/cma-home/.codex/cma/accounts/work/auth.json",
  );
  for (const value of ["../escape", "work/other", "work\\other", "\0"]) {
    assert.throws(() => resolveProfilePaths(paths, value), /unsafe/i);
  }
});

test("validates names and creates deterministic duplicate-safe slugs", () => {
  assert.equal(slugifyProfileName(" Déjà Vu "), "deja-vu");
  assert.equal(uniqueProfileSlug("Work", ["work", "work-2"]), "work-3");
  for (const name of ["", ".", "..", "a/b", "CON", "bad\nname", "name."]) {
    assert.throws(() => validateAccountName(name));
  }
  assert.doesNotThrow(() => validateAccountName("日本語 アカウント"));
});

test("rejects Windows reserved names and path separators", () => {
  for (const name of ["CON", "con.txt", "PRN", "COM1", "LPT9"]) {
    assert.throws(() => validateAccountName(name), /invalid/i);
  }
  for (const slug of ["C:profile", "profile\\child", "profile/child"]) {
    assert.throws(() => resolveProfilePaths(resolvePaths("C:\\Users\\test"), slug), /unsafe/i);
  }
});

test("atomic writes preserve the old file until replacement completes", async () => {
  const home = await temporaryHome();
  try {
    const target = path.join(home, "nested", "secret.json");
    await writeAtomic(target, "old");
    await writeAtomic(target, "new");
    assert.equal(await readFile(target, "utf8"), "new");
    const backup = path.join(home, "backup.json");
    await copyFileAtomic(target, backup);
    await writeAtomic(target, "changed");
    await rollbackFile(target, backup);
    assert.equal(await readFile(target, "utf8"), "new");
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    assert.equal(
      (await readdir(path.dirname(target))).some((name) => name.includes(".tmp-")),
      false,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("cleans the temporary file when atomic replacement is interrupted", async () => {
  const home = await temporaryHome();
  try {
    const target = path.join(home, "target");
    await mkdir(target);
    await assert.rejects(() => writeAtomic(target, "new"));
    assert.equal(
      (await readdir(home)).some((name) => name.startsWith(".target.tmp-")),
      false,
    );
    assert.equal((await stat(target)).isDirectory(), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("parses auth without exposing token values and fingerprints exact bytes", () => {
  const secret = "refresh-secret-for-test";
  const parsed = parseAuthFile(
    JSON.stringify({
      tokens: { access_token: "access-secret", refresh_token: secret },
      account_id: "acct-1",
      email: "user@example.com",
    }),
  );
  assert.equal(parsed.identity.email, "user@example.com");
  assert.equal(parsed.identity.accountId, "acct-1");
  assert.notEqual(
    parsed.fingerprint.value,
    fingerprintAuth(JSON.stringify({ tokens: { refresh_token: secret } })).value,
  );
  assert.throws(
    () => parseAuthFile(`{"tokens":{"refresh_token":"${secret}`),
    (error: unknown) => {
      assert.equal((error as Error).message.includes(secret), false);
      return true;
    },
  );
  assert.deepEqual(extractAuthIdentity({ OPENAI_API_KEY: "api-secret" }), { authMode: "apiKey" });
});

test("keeps JWT identity available for display but not structured ownership", () => {
  const payload = Buffer.from(
    JSON.stringify({ email: "jwt@example.com", account_id: "jwt-account" }),
  ).toString("base64url");
  const auth = { tokens: { access_token: `header.${payload}.signature` } };
  assert.deepEqual(extractAuthIdentity(auth), {
    email: "jwt@example.com",
    accountId: "jwt-account",
  });
  assert.deepEqual(parseAuthFile(JSON.stringify(auth)).structuredIdentity, {});
});

test("repository CRUD stores auth atomically and reconciles directory slugs", async () => {
  const home = await temporaryHome();
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const first = await repository.createProfile("Work");
    const duplicate = await repository.createProfile("Work");
    assert.equal(first.slug, "work");
    assert.equal(duplicate.slug, "work-2");

    const auth = Buffer.from(JSON.stringify({ tokens: { refresh_token: "fake-refresh" } }));
    await repository.writeProfileAuth(first.id, auth);
    assert.equal(await repository.profileAuthExists(first.id), true);
    assert.deepEqual(Buffer.from(await repository.readProfileAuth(first.id)), auth);
    await assert.rejects(
      () => repository.writeProfileAuth(first.id, Buffer.from("{}")),
      /missing credential data/,
    );

    const profilePath = resolveProfilePaths(paths, first.slug).metadataPath;
    const metadata = JSON.parse(await readFile(profilePath, "utf8"));
    await writeFile(profilePath, JSON.stringify({ ...metadata, slug: "wrong" }));
    assert.equal((await repository.getProfileBySlug(first.slug))?.slug, first.slug);
    assert.equal(JSON.parse(await readFile(profilePath, "utf8")).slug, first.slug);

    const renamed = await repository.renameProfile(first.id, "Personal");
    assert.equal(renamed.slug, "personal");
    assert.equal(await repository.getProfileBySlug("work"), undefined);
    await repository.deleteProfileAuth(first.id);
    assert.equal(await repository.profileAuthExists(first.id), false);
    await repository.deleteProfile(first.id);
    assert.equal(await repository.getProfile(first.id), undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
