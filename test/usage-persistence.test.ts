import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AccountRepository } from "../src/accounts/accountRepository.js";
import { writeStateFile } from "../src/accounts/accountService.js";
import { resolvePaths } from "../src/config/paths.js";
import { AttributionService } from "../src/usage/attributionService.js";
import { UsageDatabase } from "../src/usage/database.js";
import { UsageRepository } from "../src/usage/usageRepository.js";
import { UsageService } from "../src/usage/usageService.js";

test("restores account intervals and rollout cursor model from SQLite", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-usage-persistence-"));
  const database = new UsageDatabase(path.join(home, "usage.sqlite"));
  try {
    const repository = new UsageRepository(await database.open());
    for (const [id, name, slug] of [
      ["profile-a", "A", "a"],
      ["profile-b", "B", "b"],
    ] as const) {
      repository.upsertProfile({
        id,
        name,
        slug,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    }
    repository.startInterval("profile-a", "a@example.com", "2026-01-01T00:00:00.000Z");
    repository.startInterval("profile-b", "b@example.com", "2026-01-02T00:00:00.000Z");

    const attribution = new AttributionService();
    attribution.restore(repository.listIntervals());
    assert.equal(attribution.resolve("2026-01-01T12:00:00.000Z")?.profileId, "profile-a");
    assert.equal(attribution.resolve("2026-01-02T12:00:00.000Z")?.accountAddress, "b@example.com");

    repository.writeCursor("rollout.jsonl", {
      byteOffset: 12,
      partialLine: "",
      initialized: true,
      epoch: 0,
      model: "gpt-test",
    });
    assert.equal(repository.readCursor("rollout.jsonl")?.model, "gpt-test");
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("uses persisted intervals when a service backfills after restart", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-usage-restart-"));
  const paths = resolvePaths(home);
  const profiles = new AccountRepository(paths);
  const database = new UsageDatabase(paths.usageDbPath);
  try {
    const first = await profiles.createProfile("First");
    const second = await profiles.createProfile("Second");
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: second.id,
      selectedProfileSlug: second.slug,
    });

    const seedRepository = new UsageRepository(await database.open());
    for (const profile of [first, second]) {
      seedRepository.upsertProfile({
        id: profile.id,
        name: profile.name,
        slug: profile.slug,
        createdAt: profile.createdAt,
      });
    }
    seedRepository.startInterval(first.id, "first@example.com", "2026-01-01T00:00:00.000Z");
    seedRepository.startInterval(second.id, "second@example.com", "2026-01-02T00:00:00.000Z");
    database.close();

    const sessions = path.join(paths.codexHome, "sessions");
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, "rollout-history.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-01-02T12:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 20, cached_input_tokens: 10, output_tokens: 2 },
            last_token_usage: { input_tokens: 20, cached_input_tokens: 10, output_tokens: 2 },
          },
        },
      })}\n`,
    );

    const usage = new UsageService(paths, profiles, new UsageDatabase(paths.usageDbPath));
    await usage.start();
    assert.equal(usage.totals({ profileId: second.id }).inputTokens, 20n);
    assert.equal(usage.totals({ profileId: first.id }).inputTokens, 0n);
    await usage.stop();
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("creates a consistent backup from a WAL database", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-usage-backup-"));
  const sourcePath = path.join(home, "usage.sqlite");
  const targetPath = path.join(home, "backup", "usage.sqlite");
  const source = new UsageDatabase(sourcePath);
  const target = new UsageDatabase(targetPath);
  try {
    const connection = await source.open();
    connection.exec(
      "CREATE TABLE backup_marker (value TEXT); INSERT INTO backup_marker VALUES ('ok');",
    );
    await source.backup(targetPath);

    const backupConnection = await target.open();
    assert.equal(backupConnection.prepare("SELECT value FROM backup_marker").all()[0]?.value, "ok");
  } finally {
    target.close();
    source.close();
    await rm(home, { recursive: true, force: true });
  }
});
