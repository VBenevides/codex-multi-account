import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AccountRepository } from "../src/accounts/accountRepository.js";
import { SignOutService } from "../src/accounts/signOutService.js";
import { readStateFile, writeStateFile } from "../src/accounts/accountService.js";
import { readAuthFile } from "../src/accounts/authFile.js";
import { resolvePaths } from "../src/config/paths.js";

const auth = (accountId: string, refreshToken = accountId) =>
  Buffer.from(
    JSON.stringify({ tokens: { refresh_token: `fake-${refreshToken}` }, account_id: accountId }),
  );

async function fakeHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cma-signout-"));
}

async function createSelectedProfile(home: string, stored: Buffer, live = stored) {
  const paths = resolvePaths(home);
  const repository = new AccountRepository(paths);
  const profile = await repository.createProfile("Personal");
  await repository.writeProfileAuth(profile.id, stored);
  await mkdir(path.dirname(paths.liveAuthPath), { recursive: true });
  await writeFile(paths.liveAuthPath, live);
  await writeStateFile(paths.statePath, {
    version: 1,
    selectedProfileId: profile.id,
    selectedProfileSlug: profile.slug,
  });
  return { paths, repository, profile };
}

test("signs out a non-selected profile without touching live auth or state", async () => {
  const home = await fakeHome();
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const selected = await repository.createProfile("Selected");
    const other = await repository.createProfile("Other");
    await repository.writeProfileAuth(selected.id, auth("selected"));
    await repository.writeProfileAuth(other.id, auth("other"));
    await mkdir(path.dirname(paths.liveAuthPath), { recursive: true });
    await writeFile(paths.liveAuthPath, auth("selected"));
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: selected.id,
      selectedProfileSlug: selected.slug,
    });

    const result = await new SignOutService({ repository, paths }).signOut(other.id);

    assert.deepEqual(result, {
      profileId: other.id,
      profileSlug: other.slug,
      selected: false,
      changed: true,
    });
    assert.equal(await repository.profileAuthExists(other.id), false);
    assert.equal(await repository.profileAuthExists(selected.id), true);
    assert.equal((await readAuthFile(paths.liveAuthPath)).identity.accountId, "selected");
    assert.equal((await readStateFile(paths.statePath)).selectedProfileId, selected.id);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("signs out the selected profile after validating refreshed live ownership", async () => {
  const home = await fakeHome();
  try {
    const { paths, repository, profile } = await createSelectedProfile(
      home,
      auth("account-1", "old-refresh"),
      auth("account-1", "new-refresh"),
    );
    const events: string[] = [];
    const result = await new SignOutService({
      repository,
      paths,
      now: () => new Date("2026-08-16T12:00:00.000Z"),
      closeInterval: (profileId, at) => {
        events.push(`close:${profileId}:${at}`);
      },
      reload: () => {
        events.push("reload");
      },
    }).signOut(profile.id);

    assert.deepEqual(result, {
      profileId: profile.id,
      profileSlug: profile.slug,
      selected: true,
      changed: true,
    });
    assert.deepEqual(events, [`close:${profile.id}:2026-08-16T12:00:00.000Z`, "reload"]);
    assert.equal(await repository.profileAuthExists(profile.id), false);
    await assert.rejects(() => readFile(paths.liveAuthPath), { code: "ENOENT" });
    assert.equal((await readStateFile(paths.statePath)).selectedProfileId, null);
    await assert.rejects(() => readFile(paths.switchLockPath), { code: "ENOENT" });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("rejects selected sign-out when live auth belongs to another account", async () => {
  const home = await fakeHome();
  try {
    const { paths, repository, profile } = await createSelectedProfile(
      home,
      auth("account-1"),
      auth("account-2"),
    );

    await assert.rejects(
      () => new SignOutService({ repository, paths }).signOut(profile.id),
      /does not own the live auth/,
    );
    assert.equal(await repository.profileAuthExists(profile.id), true);
    assert.equal((await readAuthFile(paths.liveAuthPath)).identity.accountId, "account-2");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("restores auth and state when a selected sign-out hook fails", async () => {
  const home = await fakeHome();
  try {
    const { paths, repository, profile } = await createSelectedProfile(home, auth("account-1"));

    await assert.rejects(
      () =>
        new SignOutService({
          repository,
          paths,
          reload: () => {
            throw new Error("reload unavailable");
          },
        }).signOut(profile.id),
      /reload unavailable/,
    );
    assert.equal(await repository.profileAuthExists(profile.id), true);
    assert.equal((await readAuthFile(paths.liveAuthPath)).identity.accountId, "account-1");
    assert.equal((await readStateFile(paths.statePath)).selectedProfileId, profile.id);
    assert.equal(
      (await readdir(path.dirname(paths.liveAuthPath))).some((name) =>
        name.includes(".cma-signout-rollback-"),
      ),
      false,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
