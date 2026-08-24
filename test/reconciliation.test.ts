import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AccountRepository } from "../src/accounts/accountRepository.js";
import { readStateFile, writeStateFile } from "../src/accounts/accountService.js";
import { ReconciliationService } from "../src/accounts/reconciliationService.js";
import { resolvePaths } from "../src/config/paths.js";

const auth = (accountId: string, refreshToken = accountId) =>
  Buffer.from(
    JSON.stringify({ tokens: { refresh_token: `secret-${refreshToken}` }, account_id: accountId }),
  );

async function fakeHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cma-reconciliation-"));
}

async function setup(home: string) {
  const paths = resolvePaths(home);
  const repository = new AccountRepository(paths);
  const selected = await repository.createProfile("Selected");
  const other = await repository.createProfile("Other");
  await repository.writeProfileAuth(selected.id, auth("selected", "old"));
  await repository.writeProfileAuth(other.id, auth("other"));
  await mkdir(path.dirname(paths.liveAuthPath), { recursive: true });
  await writeStateFile(paths.statePath, {
    version: 1,
    selectedProfileId: selected.id,
    selectedProfileSlug: selected.slug,
  });
  return { paths, repository, selected, other };
}

test("classifies a selected account after a token refresh without changing live auth", async () => {
  const home = await fakeHome();
  try {
    const { paths, repository, selected } = await setup(home);
    const live = auth("selected", "refreshed");
    await writeFile(paths.liveAuthPath, live);

    const service = new ReconciliationService(repository, paths);
    const result = await service.reconcile();
    assert.equal(result.status, "selected-match");
    assert.equal(result.matchedProfile?.id, selected.id);

    const repaired = await service.repairSelectedState();
    assert.equal(repaired.repaired, false);
    assert.equal(repaired.reason, "already-selected");
    assert.deepEqual(await readFile(paths.liveAuthPath), live);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("repairs selected state to another known profile without mutating live auth", async () => {
  const home = await fakeHome();
  try {
    const { paths, repository, selected, other } = await setup(home);
    const live = auth("other");
    await writeFile(paths.liveAuthPath, live);

    const service = new ReconciliationService(repository, paths, {
      now: () => new Date("2026-08-16T12:00:00.000Z"),
    });
    const result = await service.reconcile();
    assert.equal(result.status, "known-profile");
    assert.equal(result.selectedProfile?.id, selected.id);
    assert.equal(result.matchedProfile?.id, other.id);

    const repaired = await service.repairSelectedState();
    assert.equal(repaired.repaired, true);
    assert.equal(repaired.profile?.id, other.id);
    assert.deepEqual(await readFile(paths.liveAuthPath), live);
    assert.equal((await readStateFile(paths.statePath)).selectedProfileId, other.id);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("imports unmanaged live auth into a profile without changing live auth", async () => {
  const home = await fakeHome();
  try {
    const { paths, repository } = await setup(home);
    const live = auth("unmanaged");
    await writeFile(paths.liveAuthPath, live);
    const service = new ReconciliationService(repository, paths);

    assert.equal((await service.reconcile()).status, "unmanaged");
    const imported = await service.importCurrentAccount("Imported");
    assert.equal(imported.imported, true);
    assert.equal(imported.profile?.name, "Imported");
    assert.equal(JSON.stringify(imported).includes("secret-unmanaged"), false);
    assert.deepEqual(await readFile(paths.liveAuthPath), live);
    assert.deepEqual(Buffer.from(await repository.readProfileAuth(imported.profile!.id)), live);
    assert.equal((await service.reconcile()).status, "known-profile");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("classifies missing and invalid live auth and leaves both untouched", async () => {
  const home = await fakeHome();
  try {
    const { paths, repository } = await setup(home);
    const service = new ReconciliationService(repository, paths);
    assert.equal((await service.reconcile()).status, "missing-live-auth");
    assert.equal((await service.repairSelectedState()).reason, "missing-live-auth");
    assert.equal((await service.importCurrentAccount("Missing")).reason, "missing-live-auth");

    const invalid = Buffer.from('{"not_auth":true}');
    await writeFile(paths.liveAuthPath, invalid);
    assert.equal((await service.reconcile()).status, "invalid-live-auth");
    assert.equal((await service.repairSelectedState()).reason, "invalid-live-auth");
    assert.equal((await service.importCurrentAccount("Invalid")).reason, "invalid-live-auth");
    assert.deepEqual(await readFile(paths.liveAuthPath), invalid);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
