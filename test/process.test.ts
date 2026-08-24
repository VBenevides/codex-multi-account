import { strict as assert } from "node:assert";
import test from "node:test";
import { ProcessRunner } from "../src/infra/process.js";

test("process runner cancels a timed out child", async () => {
  const result = await new ProcessRunner().run(
    process.execPath,
    ["-e", "setTimeout(() => {}, 1000)"],
    { timeoutMs: 25 },
  );
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, true);
});

test("process runner responds to an abort signal", async () => {
  const controller = new AbortController();
  const promise = new ProcessRunner().run(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], {
    signal: controller.signal,
  });
  controller.abort();
  const result = await promise;
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
});
