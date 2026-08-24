import * as vscode from "vscode";
import { writeFile } from "node:fs/promises";
import { AccountRepository } from "./accounts/accountRepository.js";
import { AuthSyncService } from "./accounts/authSyncService.js";
import { registerCommands } from "./commands/registerCommands.js";
import { AccountsTreeProvider } from "./ui/accountsTreeProvider.js";
import { StatusBar } from "./ui/statusBar.js";
import { resolvePaths } from "./config/paths.js";
import { UsageService } from "./usage/usageService.js";
import { QuotaService } from "./usage/quotaService.js";
import { registerRecoveryCommands } from "./commands/registerRecoveryCommands.js";
import { cleanupLoginStaging } from "./accounts/signInService.js";
import {
  serializeUsageBreakdownCsv,
  serializeUsageDailyCsv,
  serializeUsageJson,
} from "./usage/usageExport.js";
import type { QuotaRequestPolicy } from "./usage/quotaService.js";

let sync: AuthSyncService | undefined;
let usage: UsageService | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const repository = new AccountRepository();
  await cleanupLoginStaging(repository.paths);
  const provider = new AccountsTreeProvider(repository);
  const tree = vscode.window.createTreeView("cma.accounts", { treeDataProvider: provider });
  const status = new StatusBar();
  sync = new AuthSyncService(repository);
  usage = new UsageService(resolvePaths(), repository, undefined, (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    status.setProfile(undefined, true);
    void vscode.window.showWarningMessage(`CMA usage tracking is unavailable: ${detail}`);
  });
  const readQuotaPolicy = () =>
    vscode.workspace
      .getConfiguration("cma")
      .get<QuotaRequestPolicy>("quotaNetworkAccess", "disabled");
  await sync.start().catch(() => undefined);
  await usage.start();
  if (usage.health.degraded) status.setProfile(undefined, true);
  await provider.startWatching().catch(() => undefined);
  registerCommands(
    context,
    provider,
    repository,
    (profileId, at) => usage?.switchTo(profileId, at),
    (profileId, at) => usage?.closeInterval(profileId, at),
    (profileId) => usage?.syncProfile(profileId),
    (profileId) => usage?.deleteProfile(profileId),
    (profileId) => usage?.syncProfile(profileId),
    (profileId) => usage?.syncProfile(profileId),
    (filter) =>
      usage?.totals(filter) ?? { inputTokens: 0n, cachedInputTokens: 0n, outputTokens: 0n },
    async () => {
      const policy = readQuotaPolicy();
      const quotas = new QuotaService(repository, fetch, { policy });
      return policy === "disabled" ? quotas.cached() : quotas.list();
    },
    (filter) => usage?.breakdown(filter) ?? [],
    (filter) => usage?.filterOptions(filter) ?? { models: [], workingDirectories: [] },
    (filter, options) => usage?.daily(filter, options) ?? [],
    async (format, filter) => {
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${repository.paths.cmaHome}/usage.${format}`),
        filters: { [format.toUpperCase()]: [format] },
        saveLabel: `Export ${format.toUpperCase()}`,
      });
      if (!target || !usage) return;
      const content =
        format === "json"
          ? serializeUsageJson({ breakdown: usage.breakdown(filter), daily: usage.daily(filter) })
          : `${serializeUsageBreakdownCsv(usage.breakdown(filter))}\r\n${serializeUsageDailyCsv(usage.daily(filter))}`;
      await writeFile(target.fsPath, content, { encoding: "utf8" });
      void vscode.window.showInformationMessage(`Usage exported to ${target.fsPath}.`);
    },
    () => usage?.health ?? { watcherHealth: "unknown", parserFailureCount: 0, degraded: true },
  );
  registerRecoveryCommands(context, provider, repository, usage);
  context.subscriptions.push(
    tree,
    provider,
    status,
    { dispose: () => void sync?.stop() },
    { dispose: () => void usage?.stop() },
  );
}

export function deactivate(): Thenable<void> | undefined {
  return Promise.all([sync?.stop(), usage?.stop()]).then(() => undefined);
}
