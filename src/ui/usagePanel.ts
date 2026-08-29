import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type {
  UsageAccount,
  UsageBreakdown,
  UsageDaily,
  UsageDailyOptions,
  UsageFilter,
  UsageFilterOptions,
  UsageTotals,
} from "../usage/usageRepository.js";
import type { AccountQuota } from "../usage/quotaService.js";
import { formatCachingRate, formatTokenCount } from "../usage/format.js";
import { formatWorkingDirectory, type WorkingDirectoryDisplay } from "../usage/privacy.js";
import { renderUsageHtml } from "./usageHtml.js";
import type { UsageExportFormat } from "../usage/usageExport.js";
import { KEEP_ALIVE_STATE_KEY } from "../accounts/keepAliveService.js";

type TotalsReader = (filter: UsageFilter) => UsageTotals;
type QuotaReader = () => Promise<AccountQuota[]>;
type AccountReader = () => Promise<UsageAccount[]>;
type BreakdownReader = (filter: UsageFilter) => UsageBreakdown[];
type FilterOptionsReader = (filter: UsageFilter) => UsageFilterOptions;
type DailyReader = (filter: UsageFilter, options?: UsageDailyOptions) => UsageDaily[];
type Exporter = (format: UsageExportFormat, filter: UsageFilter) => Promise<void> | void;
type KeepAliveRunner = () => Promise<void> | void;

const DEFAULT_DAYS = 30;
const PERIODS = new Set([1, 7, 30]);
const GRANULARITIES = new Set(["hour", "day", "week", "month"]);
const GROUPS = new Set(["model", "project", "account"]);
const USAGE_STATE_KEY = "usageViewState";

type UsageViewState = { filters?: Record<string, unknown> };

export class UsagePanel {
  private static current?: vscode.WebviewPanel;

  static show(
    extensionUri: vscode.Uri,
    readTotals: TotalsReader,
    readQuotas: QuotaReader,
    readAccounts: AccountReader = async () => [],
    readBreakdown: BreakdownReader = () => [],
    readFilterOptions: FilterOptionsReader = () => ({ models: [], workingDirectories: [] }),
    readDaily: DailyReader = () => [],
    workingDirectoryDisplay: WorkingDirectoryDisplay = "full",
    exportUsage?: Exporter,
    globalState?: vscode.Memento,
    runKeepAlive?: KeepAliveRunner,
  ): void {
    if (UsagePanel.current) {
      UsagePanel.current.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "cma.usage",
      "CMA Usage",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      },
    );
    const nonce = randomBytes(16).toString("hex");
    panel.webview.html = renderUsageHtml(nonce, globalState?.get<UsageViewState>(USAGE_STATE_KEY));
    let loading = false;
    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isMessage(message) || loading) return;
      loading = true;
      void globalState?.update(USAGE_STATE_KEY, {
        filters: {
          period: message.period,
          profileId: message.profileId ?? "",
          model: message.model ?? "",
          workingDirectory: message.workingDirectory ?? "",
        },
      });
      const period = normalizePeriod(message.period ?? message.days);
      const now = new Date();
      void panel.webview.postMessage({ type: "state", state: "loading" });
      try {
        const filter = createFilter(
          period,
          now,
          message.profileId,
          message.model,
          message.workingDirectory,
        );
        const totals = readTotals(filter);
        const breakdown = readBreakdown(filter);
        const daily = readDaily(filter, {
          granularity: normalizeGranularity(message.chartGranularity),
          groupBy: normalizeGroupBy(message.chartGroup),
        });
        const previous =
          period === null
            ? undefined
            : readTotals(
                createFilter(
                  period,
                  new Date(now.getTime() - period * 86_400_000),
                  message.profileId,
                  message.model,
                  message.workingDirectory,
                ),
              );
        const filterOptions = readFilterOptions({
          ...filter,
          model: undefined,
          workingDirectory: undefined,
        });
        if (message.type === "exportCsv" || message.type === "exportJson") {
          await exportUsage?.(message.type === "exportCsv" ? "csv" : "json", filter);
          return;
        }
        if (message.type === "refresh") await runKeepAlive?.();
        const loadOptions = message.type === "ready" || message.type === "refresh";
        const accounts = loadOptions ? await readAccounts() : undefined;
        const empty =
          totals.inputTokens === 0n &&
          totals.cachedInputTokens === 0n &&
          totals.outputTokens === 0n;
        void panel.webview.postMessage({
          type: "state",
          state: empty ? "empty" : "ready",
        });
        void panel.webview.postMessage({
          type: "usage",
          range: periodLabel(period),
          updatedAt: now.toISOString(),
          inputTokens: formatTokenCount(totals.inputTokens),
          inputTokensRaw: totals.inputTokens.toString(),
          cachedInputTokens: formatTokenCount(totals.cachedInputTokens),
          cachedInputTokensRaw: totals.cachedInputTokens.toString(),
          uncachedInputTokens: formatTokenCount(
            uncachedInput(totals.inputTokens, totals.cachedInputTokens),
          ),
          uncachedInputTokensRaw: uncachedInput(
            totals.inputTokens,
            totals.cachedInputTokens,
          ).toString(),
          cachedPercent: formatCachingRate(totals.cachedInputTokens, totals.inputTokens),
          outputTokens: formatTokenCount(totals.outputTokens),
          outputTokensRaw: totals.outputTokens.toString(),
          interactions: daily.reduce((sum, row) => sum + row.interactions, 0),
          ...(previous
            ? {
                previous: {
                  inputTokens: previous.inputTokens.toString(),
                  cachedInputTokens: previous.cachedInputTokens.toString(),
                  outputTokens: previous.outputTokens.toString(),
                },
              }
            : {}),
          breakdown: breakdown.map((row) => ({
            accountName: row.accountName,
            workingDirectory: formatWorkingDirectory(row.workingDirectory, workingDirectoryDisplay),
            projectName: formatWorkingDirectory(row.workingDirectory, "basename"),
            model: row.model,
            totalTokens: formatTokenCount(row.inputTokens + row.outputTokens),
            totalTokensRaw: (row.inputTokens + row.outputTokens).toString(),
            inputTokens: formatTokenCount(row.inputTokens),
            inputTokensRaw: row.inputTokens.toString(),
            cachedInputTokens: formatTokenCount(row.cachedInputTokens),
            cachedInputTokensRaw: row.cachedInputTokens.toString(),
            outputTokens: formatTokenCount(row.outputTokens),
            outputTokensRaw: row.outputTokens.toString(),
            interactions: row.interactions ?? 0,
          })),
          daily: daily.map((row) => ({
            date: row.date,
            model: row.model,
            tokens: String(row.inputTokens + row.outputTokens),
            inputTokens: row.inputTokens.toString(),
            cachedTokens: row.cachedInputTokens?.toString() ?? "0",
            uncachedTokens: uncachedInput(row.inputTokens, row.cachedInputTokens ?? 0n).toString(),
            outputTokens: row.outputTokens.toString(),
            interactions: row.interactions,
            accountName: row.accountName,
            workingDirectory: row.workingDirectory
              ? formatWorkingDirectory(row.workingDirectory, workingDirectoryDisplay)
              : undefined,
            projectName: row.workingDirectory
              ? formatWorkingDirectory(row.workingDirectory, "basename")
              : undefined,
            dimension: row.dimension,
          })),
          filters: {
            ...filterOptions,
            workingDirectoryLabels: Object.fromEntries(
              filterOptions.workingDirectories.map((value) => [
                value,
                formatWorkingDirectory(value, workingDirectoryDisplay),
              ]),
            ),
          },
          ...(accounts ? { accounts } : {}),
        });
        if (loadOptions) {
          void Promise.resolve()
            .then(readQuotas)
            .then((quotas) => {
              const lastKeepAliveAt =
                globalState?.get<Record<string, number>>(KEEP_ALIVE_STATE_KEY) ?? {};
              return panel.webview.postMessage({
                type: "quota",
                quotas: quotas.map((quota) => ({
                  ...quota,
                  lastKeepAliveAt: quota.profileId
                    ? (lastKeepAliveAt[quota.profileId] ?? null)
                    : null,
                })),
              });
            })
            .catch(() => panel.webview.postMessage({ type: "quota", quotas: [] }));
        }
      } catch {
        void panel.webview.postMessage({
          type: "state",
          state: "error",
          message: "Unable to load usage. Try Refresh.",
        });
      } finally {
        loading = false;
      }
    });
    panel.onDidDispose(() => {
      UsagePanel.current = undefined;
    });
    UsagePanel.current = panel;
  }
}

function uncachedInput(input: bigint, cached: bigint): bigint {
  return input > cached ? input - cached : 0n;
}

function isMessage(value: unknown): value is {
  type?: unknown;
  days?: unknown;
  period?: unknown;
  profileId?: unknown;
  model?: unknown;
  workingDirectory?: unknown;
  chartGroup?: unknown;
  chartGranularity?: unknown;
} {
  return typeof value === "object" && value !== null;
}

function normalizePeriod(value: unknown): number | null {
  if (value === null || value === "all") return null;
  const days = typeof value === "number" ? value : Number(value);
  return PERIODS.has(days) ? days : DEFAULT_DAYS;
}

function createFilter(
  period: number | null,
  now: Date,
  profileId: unknown,
  model: unknown,
  workingDirectory: unknown,
): UsageFilter {
  const filter: UsageFilter = {};
  if (typeof profileId === "string" && profileId.length > 0) filter.profileId = profileId;
  if (typeof model === "string" && model.length > 0) filter.model = model;
  if (typeof workingDirectory === "string" && workingDirectory.length > 0)
    filter.workingDirectory = workingDirectory;
  if (period === null) return filter;
  const from = new Date(now);
  from.setTime(now.getTime() - period * 86_400_000);
  filter.from = from.toISOString();
  filter.until = now.toISOString();
  return filter;
}

function periodLabel(period: number | null): string {
  if (period === 1) return "Last 24 hours";
  return period === null ? "All time" : `Last ${period} days`;
}

function normalizeGranularity(value: unknown): UsageDailyOptions["granularity"] {
  return typeof value === "string" && GRANULARITIES.has(value)
    ? (value as UsageDailyOptions["granularity"])
    : "day";
}

function normalizeGroupBy(value: unknown): UsageDailyOptions["groupBy"] {
  return typeof value === "string" && GROUPS.has(value)
    ? (value as UsageDailyOptions["groupBy"])
    : "model";
}
