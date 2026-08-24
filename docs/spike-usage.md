# Token usage spike

Date: 2026-08-16

The repository contains sanitized synthetic `event_msg/token_count` records in `test/fixtures/rollout-token-count.jsonl`. The fixture covers top-level timestamps, ordinal values, cumulative input/cached/output totals, and `last_token_usage`. Unit tests prove that the first cumulative snapshot establishes a no-backfill baseline, repeated cumulative totals do not create usage, and a confirmed cumulative reset counts `last_token_usage` once in a new epoch.

No live Codex conversation was generated or copied. An existing rollout path was discoverable in the local Codex home, but its path and contents were withheld. Live resume, account-switch-in-one-rollout, and native event production remain manual tests in an isolated test home.
