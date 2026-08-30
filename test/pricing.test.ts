import { strict as assert } from "node:assert";
import test from "node:test";
import { estimateModelCostMicros } from "../src/usage/pricing.js";

test("estimates model cost from uncached, cached, and output tokens", () => {
  assert.equal(estimateModelCostMicros("gpt-5.6-luna", 1_000_000n, 250_000n, 100_000n), 275_000n);
  assert.equal(
    estimateModelCostMicros("codex-auto-review", 1_000_000n, 250_000n, 100_000n),
    275_000n,
  );
  assert.equal(estimateModelCostMicros("unknown", 1n, 0n, 1n), undefined);
  assert.equal(
    estimateModelCostMicros("custom-model", 1_000_000n, 0n, 1_000_000n, {
      "custom-model": { input: 2, output: 3 },
    }),
    5_000_000n,
  );
});
