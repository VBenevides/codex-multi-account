import { strict as assert } from "node:assert";
import test from "node:test";
import {
  serializeUsageBreakdownCsv,
  serializeUsageDailyCsv,
  serializeUsageJson,
} from "../src/usage/usageExport.js";

test("serializes grouped usage as escaped CSV", () => {
  assert.equal(
    serializeUsageBreakdownCsv([
      {
        accountName: "Personal, main",
        workingDirectory: "/tmp/a\nproject",
        model: 'model "one"',
        inputTokens: 12_345n,
        cachedInputTokens: 10_000n,
        outputTokens: 67n,
      },
    ]),
    'accountName,workingDirectory,model,inputTokens,cachedInputTokens,outputTokens\r\n"Personal, main","/tmp/a\nproject","model ""one""",12345,10000,67\r\n',
  );
});

test("serializes daily usage as CSV and both views as credential-free JSON", () => {
  const daily = [
    { date: "2026-08-16", model: "gpt-test", inputTokens: 10n, outputTokens: 2n, interactions: 3 },
  ];
  const json = serializeUsageJson({
    breakdown: [
      {
        accountName: "Personal",
        workingDirectory: "/work",
        model: "gpt-test",
        inputTokens: 10n,
        cachedInputTokens: 8n,
        outputTokens: 2n,
      },
    ],
    daily,
  });

  assert.equal(
    serializeUsageDailyCsv(daily),
    "date,model,inputTokens,outputTokens,interactions\r\n2026-08-16,gpt-test,10,2,3\r\n",
  );
  assert.deepEqual(JSON.parse(json), {
    breakdown: [
      {
        accountName: "Personal",
        workingDirectory: "/work",
        model: "gpt-test",
        inputTokens: "10",
        cachedInputTokens: "8",
        outputTokens: "2",
      },
    ],
    daily: [
      {
        date: "2026-08-16",
        model: "gpt-test",
        inputTokens: "10",
        outputTokens: "2",
        interactions: 3,
      },
    ],
  });
  assert.equal(json.includes("access_token"), false);
});
