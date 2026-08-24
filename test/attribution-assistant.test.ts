import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { UsageDatabase } from "../src/usage/database.js";
import { UsageRepository } from "../src/usage/usageRepository.js";
import { parseTokenCountEvent } from "../src/usage/tokenCountParser.js";

test("attribution assistant previews and explicitly assigns unknown events", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-attribution-assistant-"));
  const database = new UsageDatabase(path.join(home, "usage.sqlite"));
  try {
    const repository = new UsageRepository(await database.open());
    repository.upsertProfile({
      id: "profile-1",
      name: "Personal",
      slug: "personal",
      createdAt: "2026-01-01T00:00:00.000Z",
      email: "personal@example.com",
    });
    const event = parseTokenCountEvent({
      timestamp: "2026-01-02T12:00:00.000Z",
      type: "event_msg",
      ordinal: 1,
      payload: {
        type: "token_count",
        info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 1 } },
      },
    })!;
    repository.insertUsage({
      profileId: null,
      accountAddress: "unknown",
      rolloutPath: "rollout",
      event: {
        event,
        delta: { inputTokens: 10n, cachedInputTokens: 2n, outputTokens: 1n },
        epoch: 0,
        sourceFingerprint: "sha256:assistant",
      },
    });
    assert.deepEqual(repository.unattributedRanges(), [{ date: "2026-01-02", events: 1 }]);
    assert.equal(
      repository.attributeUnknown(
        "profile-1",
        "personal@example.com",
        "2026-01-02T00:00:00.000Z",
        "2026-01-03T00:00:00.000Z",
      ),
      1,
    );
    assert.equal(repository.unattributedRanges().length, 0);
    assert.equal(repository.breakdown()[0].accountName, "Personal");
  } finally {
    database.close();
    await rm(home, { recursive: true, force: true });
  }
});
