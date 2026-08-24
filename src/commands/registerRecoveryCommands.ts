import { ReconciliationService } from "../accounts/reconciliationService.js";
import { AccountRepository } from "../accounts/accountRepository.js";
import { UsageService } from "../usage/usageService.js";
import { DiagnosticsService } from "../diagnostics/diagnosticsService.js";
import { CodexConfigService } from "../config/codexConfigService.js";
import * as vscode from "vscode";
import { readFile, writeFile } from "node:fs/promises";
import { ProfileTransferService } from "../accounts/profileTransferService.js";

export function registerRecoveryCommands(
  context: vscode.ExtensionContext,
  provider: { refresh(): void },
  repository: AccountRepository,
  usage: UsageService,
): void {
  const recovery = new ReconciliationService(repository);
  const transfer = new ProfileTransferService(repository);
  const importCurrent = vscode.commands.registerCommand("cma.importCurrentAccount", async () => {
    const name = await vscode.window.showInputBox({ prompt: "Imported Account Name" });
    if (!name) return;
    const result = await recovery.importCurrentAccount(name);
    if (!result.imported) {
      void vscode.window.showInformationMessage(
        result.reason === "already-known"
          ? "The current account is already imported."
          : `The current account could not be imported: ${result.reason}.`,
      );
      return;
    }
    provider.refresh();
  });
  const repair = vscode.commands.registerCommand("cma.repairSelectedProfileState", async () => {
    const result = await recovery.repairSelectedState();
    if (!result.repaired) {
      void vscode.window.showInformationMessage(
        result.reason === "already-selected"
          ? "The selected profile state is already correct."
          : `Selected profile state could not be repaired: ${result.reason}.`,
      );
      return;
    }
    provider.refresh();
    void vscode.window.showInformationMessage("Selected profile state repaired.");
  });
  const rebuild = vscode.commands.registerCommand("cma.rebuildUsageDatabase", async () => {
    if (
      (await vscode.window.showWarningMessage(
        "Rebuild usage data from rollout files? Existing usage.sqlite will be replaced.",
        { modal: true },
        "Rebuild",
      )) !== "Rebuild"
    )
      return;
    await usage.rebuildDatabase();
    void vscode.window.showInformationMessage("Usage database rebuilt.");
  });
  const backup = vscode.commands.registerCommand("cma.backupUsageDatabase", async () => {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${repository.paths.usageDbPath}.backup`),
      saveLabel: "Backup Usage Database",
    });
    if (!target) return;
    await usage.backupDatabase(target.fsPath);
    void vscode.window.showInformationMessage(`Usage database backed up to ${target.fsPath}.`);
  });
  const rescan = vscode.commands.registerCommand("cma.rescanUsageFromNow", async () => {
    await usage.rescanFromNow();
    void vscode.window.showInformationMessage("Usage scanning resumed from current rollout ends.");
  });
  const reauthenticate = vscode.commands.registerCommand(
    "cma.reauthenticateBrokenProfile",
    async () => {
      const profiles = await repository.listProfiles();
      const picked = await vscode.window.showQuickPick(
        profiles.map((profile) => ({ label: profile.name, id: profile.id })),
        { placeHolder: "Choose a profile to re-authenticate" },
      );
      if (picked) await vscode.commands.executeCommand("cma.signIn", picked.id);
    },
  );
  const exportProfile = vscode.commands.registerCommand("cma.exportProfileMetadata", async () => {
    const profiles = await repository.listProfiles();
    const picked = await vscode.window.showQuickPick(
      profiles.map((profile) => ({ label: profile.name, id: profile.id })),
      { placeHolder: "Choose profile metadata to export" },
    );
    if (!picked) return;
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${picked.label}.cma-profile.json`),
      filters: { JSON: ["json"] },
    });
    if (!target) return;
    await writeFile(target.fsPath, await transfer.exportMetadata(picked.id), { encoding: "utf8" });
    void vscode.window.showInformationMessage(`Profile metadata exported to ${target.fsPath}.`);
  });
  const importProfile = vscode.commands.registerCommand("cma.importProfileMetadata", async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ["json"] },
      openLabel: "Import Profile Metadata",
    });
    if (!picked?.[0]) return;
    const profile = await transfer.importMetadata(await readFile(picked[0].fsPath, "utf8"));
    provider.refresh();
    void vscode.window.showInformationMessage(`Imported profile "${profile.name}".`);
  });
  const attribute = vscode.commands.registerCommand("cma.attributeUsage", async () => {
    const ranges = usage.unattributedRanges();
    if (!ranges.length) {
      void vscode.window.showInformationMessage("No unattributed usage ranges were found.");
      return;
    }
    const range = await vscode.window.showQuickPick(
      ranges.map((value) => ({ label: value.date, description: `${value.events} events`, value })),
      { placeHolder: "Choose a date range to review" },
    );
    if (!range) return;
    const profiles = await repository.listProfiles();
    const profile = await vscode.window.showQuickPick(
      profiles.map((value) => ({ label: value.name, id: value.id })),
      { placeHolder: "Choose the profile for this range" },
    );
    if (!profile) return;
    const from = new Date(`${range.value.date}T00:00:00`).toISOString();
    const untilDate = new Date(`${range.value.date}T00:00:00`);
    untilDate.setDate(untilDate.getDate() + 1);
    const until = untilDate.toISOString();
    if (
      (await vscode.window.showWarningMessage(
        `Assign ${range.value.events} unattributed events on ${range.value.date} to "${profile.label}"?`,
        { modal: true },
        "Assign",
      )) !== "Assign"
    )
      return;
    const changed = await usage.attributeUnknown(profile.id, from, until);
    void vscode.window.showInformationMessage(`Assigned ${changed} usage events.`);
  });
  const health = vscode.commands.registerCommand("cma.accountHealth", async () => {
    const config = await new CodexConfigService(repository.paths.configPath).inspect();
    const value = await new DiagnosticsService(repository.paths, {
      watcherHealth: usage.health.watcherHealth,
      parserFailureCount: usage.health.parserFailureCount,
      usageDegraded: usage.health.degraded,
    }).collect();
    const summary = [
      `File-backed auth: ${config.isFileBackedAuthReady ? "ready" : "not ready"}`,
      `Live auth: ${value.liveAuthValid ? "valid" : "missing or invalid"}`,
      `Selected profile match: ${value.liveProfileMatch === null ? "unknown" : value.liveProfileMatch ? "yes" : "no"}`,
      `Usage database: ${value.sqliteHealth}`,
      `Usage watcher: ${value.watcherHealth}${value.parserFailureCount ? ` (${value.parserFailureCount} parser diagnostics)` : ""}`,
    ].join("\n");
    await vscode.window
      .showInformationMessage(
        summary,
        { modal: true },
        "Copy Diagnostics",
        "Enable File-backed Auth",
        "Rebuild Usage Database",
      )
      .then(async (choice) => {
        if (choice === "Copy Diagnostics")
          await vscode.env.clipboard.writeText(JSON.stringify(value, null, 2));
        else if (choice === "Enable File-backed Auth")
          await vscode.commands.executeCommand("cma.enableFileAuth");
        else if (choice === "Rebuild Usage Database")
          await vscode.commands.executeCommand("cma.rebuildUsageDatabase");
      });
  });
  context.subscriptions.push(
    importCurrent,
    repair,
    rebuild,
    backup,
    rescan,
    reauthenticate,
    exportProfile,
    importProfile,
    attribute,
    health,
  );
}
