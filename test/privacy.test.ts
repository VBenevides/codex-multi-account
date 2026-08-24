import { strict as assert } from "node:assert";
import test from "node:test";
import { formatWorkingDirectory } from "../src/usage/privacy.js";

test("working directory display formats without changing the stored value", () => {
  const home = "/home/example";
  const value = "/home/example/Projects/demo";
  assert.equal(formatWorkingDirectory(value, "full", home), value);
  assert.equal(formatWorkingDirectory(value, "homeRelative", home), "~/Projects/demo");
  assert.equal(formatWorkingDirectory(value, "basename", home), "demo");
  assert.equal(formatWorkingDirectory("/tmp/demo", "homeRelative", home), "/tmp/demo");
});
