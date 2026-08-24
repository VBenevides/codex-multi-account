import { strict as assert } from "node:assert";
import { lstat, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { LockService } from "../src/accounts/lockService.js";

test("lock ownership is an atomic directory claim", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-lock-dir-"));
  try {
    const lockPath = path.join(home, "switch.lock");
    const lock = new LockService(lockPath);
    const handle = await lock.acquire();
    assert.equal((await lstat(lockPath)).isDirectory(), true);
    await assert.rejects(() => lock.acquire(), /already in progress/);
    await handle.release();
    assert.equal(await lock.readInfo(), undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("concurrent lock claims leave one owner", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-lock-race-"));
  try {
    const lockPath = path.join(home, "switch.lock");
    const results = await Promise.allSettled([
      new LockService(lockPath).acquire(),
      new LockService(lockPath).acquire(),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const winner = results.find((result) => result.status === "fulfilled");
    if (winner?.status === "fulfilled") await winner.value.release();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("recovers an empty lock directory left by an interrupted claim", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-lock-orphan-"));
  try {
    const lockPath = path.join(home, "switch.lock");
    await mkdir(lockPath);
    await utimes(lockPath, new Date(0), new Date(0));
    const lock = new LockService({ lockPath, now: () => 2_000 });
    const handle = await lock.acquire();
    await handle.release();
    assert.equal(await lock.readInfo(), undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
