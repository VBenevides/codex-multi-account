import { strict as assert } from "node:assert";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  TokenCountAccumulator,
  parseTokenCountEvent,
  tokenEventFingerprint,
} from "../src/usage/tokenCountParser.js";
import { RolloutTailer } from "../src/usage/rolloutTailer.js";
import { findRollouts } from "../src/usage/rolloutWatcher.js";
import { UsageDatabase } from "../src/usage/database.js";
import { UsageRepository } from "../src/usage/usageRepository.js";
import { AttributionService } from "../src/usage/attributionService.js";
import {
  formatCachingRate,
  formatDateTime,
  formatRelativeTime,
  formatTokenCount,
} from "../src/usage/format.js";
import { parseQuotaResponse } from "../src/usage/quotaService.js";
import { migrations } from "../src/usage/migrations.js";

function mockDatabaseDriver(options: { failMigrations?: boolean; integrity?: string } = {}) {
  return () => ({
    exec(sql: string) {
      if (options.failMigrations && sql.includes("schema_migrations"))
        throw new Error("db offline");
    },
    prepare(sql: string) {
      return {
        all: () => {
          if (sql.startsWith("SELECT version FROM schema_migrations")) return [];
          if (sql.startsWith("SELECT MAX(version)")) return [{ version: migrations.length }];
          if (sql === "PRAGMA integrity_check")
            return [{ integrity_check: options.integrity ?? "ok" }];
          return [];
        },
        run: () => undefined,
      };
    },
    pragma: () => undefined,
    close: () => undefined,
  });
}

function event(
  input: number,
  cached: number,
  output: number,
  last?: [number, number, number],
): string {
  return JSON.stringify({
    timestamp: `2026-01-01T00:00:${String(input % 60).padStart(2, "0")}.000Z`,
    type: "event_msg",
    ordinal: input,
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
        },
        ...(last
          ? {
              last_token_usage: {
                input_tokens: last[0],
                cached_input_tokens: last[1],
                output_tokens: last[2],
              },
            }
          : {}),
      },
    },
  });
}

test("formats token totals compactly and calculates cache rate", () => {
  assert.equal(formatTokenCount(874n), "874");
  assert.equal(formatTokenCount(1_232n), "1.2K");
  assert.equal(formatTokenCount(123_456n), "123K");
  assert.equal(formatTokenCount(1_234_567n), "1.2M");
  assert.equal(formatTokenCount(5_403_217_493n), "5.40B");
  assert.equal(formatCachingRate(1684720000n, 1764886875n), "95.4%");
  assert.equal(formatCachingRate(2n, 1n), "100%");
  assert.equal(formatCachingRate(1n, 0n), "0%");
  assert.match(formatDateTime("2026-08-23T09:01:45.000Z", "en-US"), /Aug 23, 2026/);
  assert.equal(
    formatRelativeTime("2026-08-23T03:01:00.000Z", new Date("2026-08-19T09:01:00.000Z")),
    "in 3d 18h",
  );
});

test("parses the Codex quota window", () => {
  assert.deepEqual(
    parseQuotaResponse({
      rate_limit: {
        primary_window: { used_percent: 42, reset_at: 1_900_000_000, limit_window_seconds: 86400 },
      },
    }),
    {
      remainingPercent: 58,
      resetsAt: "2030-03-17T17:46:40.000Z",
      windows: [
        {
          remainingPercent: 58,
          resetsAt: "2030-03-17T17:46:40.000Z",
          windowSeconds: 86400,
        },
      ],
    },
  );
});

test("parses daily and weekly quota windows", () => {
  assert.deepEqual(
    parseQuotaResponse({
      rate_limit: {
        primary_window: { used_percent: 20, reset_at: 1_900_000_000, limit_window_seconds: 86400 },
        secondary_window: {
          used_percent: 40,
          reset_at: 1_900_100_000,
          limit_window_seconds: 604800,
        },
      },
    }).windows,
    [
      { remainingPercent: 80, resetsAt: "2030-03-17T17:46:40.000Z", windowSeconds: 86400 },
      { remainingPercent: 60, resetsAt: "2030-03-18T21:33:20.000Z", windowSeconds: 604800 },
    ],
  );
});

test("checks SQLite health and can reopen after a close", async () => {
  let opened = 0;
  const database = new UsageDatabase(path.join(tmpdir(), "cma-health", "usage.sqlite"), {
    driver: () => {
      opened += 1;
      return mockDatabaseDriver()();
    },
  });
  assert.deepEqual(await database.check(), {
    isOpen: true,
    schemaHealthy: true,
    schemaVersion: migrations.length,
  });
  database.close();
  await database.reopen();
  assert.equal(opened, 2);
  database.close();
});

test("reports failed SQLite initialization and leaves it reopenable", async () => {
  let attempt = 0;
  const database = new UsageDatabase(path.join(tmpdir(), "cma-health", "usage.sqlite"), {
    driver: () => {
      attempt += 1;
      return mockDatabaseDriver({ failMigrations: attempt === 1 })();
    },
  });
  const failed = await database.check();
  assert.equal(failed.isOpen, false);
  assert.match(failed.error ?? "", /db offline/);
  await database.reopen();
  assert.equal(attempt, 2);
  database.close();
});

test("parses bigint token counts and rejects negative values", () => {
  const parsed = parseTokenCountEvent(JSON.parse(event(9007199254740991, 2, 3)));
  assert.equal(parsed?.total.inputTokens, 9007199254740991n);
  assert.equal(parseTokenCountEvent({ type: "message" }), undefined);
  assert.throws(
    () =>
      parseTokenCountEvent(
        JSON.parse(event(1, 0, 0).replace('"input_tokens":1', '"input_tokens":-1')),
      ),
    /non-negative/,
  );
});

test("uses cumulative deltas and counts a confirmed reset once", () => {
  const accumulator = new TokenCountAccumulator();
  const first = parseTokenCountEvent(JSON.parse(event(10, 2, 3)))!;
  const second = parseTokenCountEvent(JSON.parse(event(15, 4, 5)))!;
  const reset = parseTokenCountEvent(JSON.parse(event(2, 1, 1, [2, 1, 1])))!;
  assert.equal(accumulator.observe(first).delta, undefined);
  assert.deepEqual(accumulator.observe(second).delta, {
    inputTokens: 5n,
    cachedInputTokens: 2n,
    outputTokens: 2n,
  });
  assert.deepEqual(accumulator.observe(reset).delta, {
    inputTokens: 2n,
    cachedInputTokens: 1n,
    outputTokens: 1n,
  });
  assert.equal(accumulator.state.epoch, 1);
  assert.equal(tokenEventFingerprint("rollout", second).startsWith("sha256:"), true);
});

test("keeps fingerprints stable when a rollout file is replaced", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-fingerprint-"));
  const file = path.join(home, "rollout-test.jsonl");
  const replacement = path.join(home, "rollout-replacement.jsonl");
  try {
    await writeFile(file, `${event(10, 2, 3)}\n`);
    const tailer = new RolloutTailer();
    const first = await tailer.tail(file, undefined, {
      startAt: "beginning",
      backfillFirst: true,
    });
    await writeFile(replacement, `${event(10, 2, 3)}\n`);
    await rename(replacement, file);
    const replay = await tailer.tail(file, first.cursor);
    assert.equal(replay.events[0]?.sourceFingerprint, first.events[0]?.sourceFingerprint);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("tails appended rollout data without rereading old bytes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-usage-"));
  const file = path.join(home, "rollout-test.jsonl");
  try {
    await writeFile(file, `${event(1, 1, 1)}\n`);
    const tailer = new RolloutTailer({ chunkBytes: 8 });
    const first = await tailer.tail(file, undefined, { startAt: "beginning" });
    assert.equal(first.events.length, 1);
    await appendFile(file, `${event(2, 2, 2)}\n`);
    const second = await tailer.tail(file, first.cursor);
    assert.equal(second.events.length, 1);
    assert.equal(second.events[0].event.ordinal, 2);
    const baseline = await tailer.tail(file);
    assert.equal(baseline.events.length, 0);
    assert.equal(baseline.cursor.byteOffset, (await readFile(file)).length);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("captures the rollout working directory from session metadata", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-working-directory-"));
  const file = path.join(home, "rollout-project.jsonl");
  try {
    await writeFile(
      file,
      `${JSON.stringify({ type: "session_meta", payload: { cwd: "/tmp/project" } })}\n${JSON.stringify({ type: "turn_context", payload: { model: "gpt-test" } })}\n${event(1, 1, 1)}\n`,
    );
    const result = await new RolloutTailer({ chunkBytes: 7 }).tail(file, undefined, {
      startAt: "beginning",
    });
    assert.equal(result.cursor.workingDirectory, "/tmp/project");
    assert.equal(result.events[0].model, "gpt-test");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("bounds memory while skipping a synthetic 50 MiB non-token line", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-large-line-"));
  const file = path.join(home, "rollout-large-line.jsonl");
  const lineBytes = 50 * 1024 * 1024;
  try {
    await writeFile(file, Buffer.alloc(lineBytes, 0x78));
    await appendFile(file, "\n");
    const result = await new RolloutTailer({
      chunkBytes: 16 * 1024,
      maxCandidateLineBytes: 64 * 1024,
    }).tail(file, undefined, { startAt: "beginning" });
    assert.equal(result.events.length, 0);
    assert.deepEqual(result.diagnostics, ["rollout line skipped: size>65536"]);
    assert.equal(result.cursor.partialLine, "");
    assert.equal(result.cursor.discardingLine, false);
    assert.equal(result.cursor.byteOffset, lineBytes + 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("captures rapidly appended token events without dropping lines", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-rapid-events-"));
  const file = path.join(home, "rollout-rapid-events.jsonl");
  try {
    await writeFile(file, `${event(1, 1, 1)}\n`);
    const tailer = new RolloutTailer({ chunkBytes: 7 });
    const first = await tailer.tail(file, undefined, { startAt: "beginning" });
    const appended = Array.from({ length: 1024 }, (_, index) =>
      event(index + 2, index + 2, index + 2),
    ).join("\n");
    await appendFile(file, `${appended}\n`);
    const second = await tailer.tail(file, first.cursor);
    assert.equal(second.events.length, 1024);
    assert.equal(second.events[0].event.ordinal, 2);
    assert.equal(second.events.at(-1)?.event.ordinal, 1025);
    assert.equal(second.cursor.partialLine, "");
    assert.equal(second.cursor.byteOffset, (await readFile(file)).byteLength);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("enumerates more than 1,000 rollout files without reading their contents", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-many-rollouts-"));
  const root = path.join(home, "sessions");
  try {
    await mkdir(root, { recursive: true });
    await Promise.all(
      Array.from({ length: 1_001 }, (_, index) =>
        writeFile(path.join(root, `rollout-${index}.jsonl`), ""),
      ),
    );
    assert.equal((await findRollouts(root)).length, 1_001);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test(
  "starts a sparse existing file at EOF without reading its contents",
  { timeout: 2_000 },
  async () => {
    const home = await mkdtemp(path.join(tmpdir(), "cma-eof-baseline-"));
    const file = path.join(home, "rollout-existing.jsonl");
    const sparseBytes = 1024 * 1024 * 1024;
    try {
      await writeFile(file, "");
      await truncate(file, sparseBytes);
      const result = await new RolloutTailer().tail(file);
      assert.deepEqual(result.events, []);
      assert.equal(result.cursor.byteOffset, sparseBytes);
      assert.equal(result.cursor.partialLine, "");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

test("stores deduplicated usage in SQLite and aggregates bigint totals", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-db-"));
  const file = path.join(home, "usage.sqlite");
  const database = new UsageDatabase(file);
  try {
    const connection = await database.open();
    const repository = new UsageRepository(connection);
    repository.upsertProfile({
      id: "profile-1",
      name: "Work",
      slug: "work",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    repository.startInterval("profile-1", "work", "2026-01-02T00:00:00.000Z");
    repository.closeInterval("profile-1", "2026-01-02T12:00:00.000Z");
    assert.equal(
      connection
        .prepare("SELECT active_until FROM account_switches WHERE profile_id = ?")
        .all("profile-1")[0].active_until,
      "2026-01-02T12:00:00.000Z",
    );
    const parsed = parseTokenCountEvent(JSON.parse(event(30, 4, 5)))!;
    const tokenEvent = {
      event: parsed,
      delta: { inputTokens: 30n, cachedInputTokens: 4n, outputTokens: 5n },
      epoch: 0,
      sourceFingerprint: "sha256:test",
    };
    assert.equal(
      repository.insertUsage({
        profileId: "profile-1",
        accountAddress: "work",
        rolloutPath: "rollout",
        workingDirectory: "/tmp/project",
        model: "gpt-test",
        event: tokenEvent,
      }),
      true,
    );
    assert.equal(
      repository.insertUsage({
        profileId: "profile-1",
        accountAddress: "work",
        rolloutPath: "rollout",
        event: tokenEvent,
      }),
      false,
    );
    assert.deepEqual(repository.totals({ profileId: "profile-1" }), {
      inputTokens: 30n,
      cachedInputTokens: 4n,
      uncachedInputTokens: 26n,
      outputTokens: 5n,
      interactions: 1,
    });
    assert.equal(
      repository.breakdown({ profileId: "profile-1" })[0].workingDirectory,
      "/tmp/project",
    );
    assert.equal(repository.breakdown({ profileId: "profile-1" })[0].model, "gpt-test");
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("attributes one rollout across a switch and commits its cursor with usage", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-attribution-"));
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
    const attribution = new AttributionService();
    const first = "2026-01-02T10:00:00.000Z";
    const second = "2026-01-02T11:00:00.000Z";
    attribution.open("profile-a", "a@example.com", first);
    attribution.open("profile-b", "b@example.com", second);
    const makeEvent = (timestamp: string, input: number, fingerprint: string) => {
      const parsed = parseTokenCountEvent({
        timestamp,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 1 },
          },
        },
      })!;
      return {
        event: parsed,
        delta: { inputTokens: BigInt(input), cachedInputTokens: 0n, outputTokens: 1n },
        epoch: 0,
        sourceFingerprint: fingerprint,
      };
    };
    repository.insertUsageBatch(
      (
        [
          [first, 10, "a"],
          [second, 20, "b"],
        ] as const
      ).map(([timestamp, input, fingerprint]) => {
        const interval = attribution.resolve(timestamp);
        return {
          profileId: interval?.profileId ?? null,
          accountAddress: interval?.accountAddress ?? null,
          rolloutPath: "rollout-shared",
          event: makeEvent(timestamp, input, fingerprint),
        };
      }),
      "rollout-shared",
      {
        byteOffset: 42,
        partialLine: "",
        initialized: true,
        epoch: 0,
      },
    );
    assert.equal(repository.totals({ profileId: "profile-a" }).inputTokens, 10n);
    assert.equal(repository.totals({ profileId: "profile-b" }).inputTokens, 20n);
    assert.equal(repository.readCursor("rollout-shared")?.byteOffset, 42);
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("aggregates Today locally and groups filtered usage", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-query-"));
  const file = path.join(home, "usage.sqlite");
  const database = new UsageDatabase(file);
  try {
    const repository = new UsageRepository(await database.open());
    repository.upsertProfile({
      id: "profile-1",
      name: "Work",
      slug: "work",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const makeEvent = (timestamp: string, input: number, fingerprint: string) => {
      const parsed = parseTokenCountEvent({
        timestamp,
        type: "event_msg",
        session_id: `session-${fingerprint}`,
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: input,
              cached_input_tokens: 1,
              output_tokens: 2,
            },
          },
        },
      })!;
      return {
        event: parsed,
        delta: { inputTokens: BigInt(input), cachedInputTokens: 1n, outputTokens: 2n },
        epoch: 0,
        sourceFingerprint: fingerprint,
      };
    };
    const yesterday = new Date(2026, 0, 1, 23, 59).toISOString();
    const todayStart = new Date(2026, 0, 2, 0, 1).toISOString();
    const todayLater = new Date(2026, 0, 2, 10).toISOString();
    for (const [timestamp, input, fingerprint] of [
      [yesterday, 10, "old"],
      [todayStart, 20, "start"],
      [todayLater, 30, "later"],
    ] as const) {
      repository.insertUsage({
        profileId: "profile-1",
        accountAddress: "work",
        rolloutPath: `rollout-${fingerprint}`,
        workingDirectory: "/tmp/project",
        model: "gpt-test",
        event: makeEvent(timestamp, input, fingerprint),
      });
    }

    assert.deepEqual(repository.todayTotals(new Date(2026, 0, 2, 12), { profileId: "profile-1" }), {
      inputTokens: 50n,
      cachedInputTokens: 2n,
      uncachedInputTokens: 48n,
      outputTokens: 4n,
      interactions: 2,
    });
    assert.deepEqual(repository.breakdown({ profileId: "profile-1" }), [
      {
        accountName: "Work",
        workingDirectory: "/tmp/project",
        model: "gpt-test",
        inputTokens: 60n,
        cachedInputTokens: 3n,
        uncachedInputTokens: 57n,
        outputTokens: 6n,
        totalTokens: 66n,
        interactions: 3,
      },
    ]);
    assert.deepEqual(repository.filterOptions({ profileId: "profile-1" }), {
      models: ["gpt-test"],
      workingDirectories: ["/tmp/project"],
    });
    assert.equal(
      repository.breakdown({
        profileId: "profile-1",
        model: "gpt-test",
        workingDirectory: "/tmp/project",
      })[0].inputTokens,
      60n,
    );
    const daily = repository.daily({ profileId: "profile-1" });
    assert.equal(daily.length, 2);
    assert.equal(daily[0].uncachedInputTokens, daily[0].inputTokens - daily[0].cachedInputTokens!);
    assert.ok(daily[0].interactions > 0);
    assert.equal(
      repository.daily({ profileId: "profile-1" }, { granularity: "day", groupBy: "project" })[0]
        .workingDirectory,
      "/tmp/project",
    );
    assert.equal(
      repository.daily({ profileId: "profile-1" }, { granularity: "month", groupBy: "account" })[0]
        .accountName,
      "Work",
    );
    assert.equal(repository.daily({ profileId: "profile-1" }, { granularity: "hour" }).length, 3);
    assert.equal(
      repository.daily({ profileId: "profile-1" }, { granularity: "week" })[0].date,
      "2025-12-29",
    );
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
