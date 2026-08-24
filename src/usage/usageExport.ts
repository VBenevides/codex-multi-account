import type { UsageBreakdown, UsageDaily } from "./usageRepository.js";

export type UsageExportFormat = "csv" | "json";

export interface UsageExportData {
  breakdown: readonly UsageBreakdown[];
  daily: readonly UsageDaily[];
}

export function serializeUsageBreakdownCsv(rows: readonly UsageBreakdown[]): string {
  return csv([
    [
      "accountName",
      "workingDirectory",
      "model",
      "inputTokens",
      "cachedInputTokens",
      "outputTokens",
    ],
    ...rows.map((row) => [
      row.accountName,
      row.workingDirectory,
      row.model,
      row.inputTokens,
      row.cachedInputTokens,
      row.outputTokens,
    ]),
  ]);
}

export function serializeUsageDailyCsv(rows: readonly UsageDaily[]): string {
  return csv([
    ["date", "model", "inputTokens", "outputTokens", "interactions"],
    ...rows.map((row) => [
      row.date,
      row.model,
      row.inputTokens,
      row.outputTokens,
      row.interactions,
    ]),
  ]);
}

export function serializeUsageJson(data: UsageExportData): string {
  return `${JSON.stringify(
    {
      breakdown: data.breakdown.map((row) => ({
        accountName: row.accountName,
        workingDirectory: row.workingDirectory,
        model: row.model,
        inputTokens: row.inputTokens.toString(),
        cachedInputTokens: row.cachedInputTokens.toString(),
        outputTokens: row.outputTokens.toString(),
      })),
      daily: data.daily.map((row) => ({
        date: row.date,
        model: row.model,
        inputTokens: row.inputTokens.toString(),
        outputTokens: row.outputTokens.toString(),
        interactions: row.interactions,
      })),
    },
    null,
    2,
  )}\n`;
}

function csv(rows: readonly (readonly (string | number | bigint)[])[]): string {
  return `${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
}

function escapeCsv(value: string | number | bigint): string {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
