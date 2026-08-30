import * as vscode from "vscode";
import { AccountRepository } from "../accounts/accountRepository.js";
import { AccountTreeItem } from "../ui/accountTreeItem.js";
import { CodexReloadService } from "../accounts/reloadService.js";
import { SignInService } from "../accounts/signInService.js";
import { SignOutService } from "../accounts/signOutService.js";
import { SwitchService } from "../accounts/switchService.js";
import { LockService } from "../accounts/lockService.js";
import { readStateFile, writeStateFile } from "../accounts/accountService.js";
import { CodexConfigService } from "../config/codexConfigService.js";
import { DiagnosticsService } from "../diagnostics/diagnosticsService.js";
import { AccountsTreeProvider } from "../ui/accountsTreeProvider.js";
import { UsagePanel } from "../ui/usagePanel.js";
import type {
  UsageBreakdown,
  UsageDaily,
  UsageDailyOptions,
  UsageFilter,
  UsageFilterOptions,
  UsageTotals,
} from "../usage/usageRepository.js";
import type { AccountQuota } from "../usage/quotaService.js";
import type { WorkingDirectoryDisplay } from "../usage/privacy.js";
import type { UsageExportFormat } from "../usage/usageExport.js";
import type { UsageHealth } from "../usage/usageService.js";
import type { ModelPricingTable } from "../usage/pricing.js";

export function registerCommands(
  context: vscode.ExtensionContext,
  provider: AccountsTreeProvider,
  repository = new AccountRepository(),
  onSwitch?: (profileId: string, at: string) => Promise<void> | void,
  onSignOut?: (profileId: string, at: string) => Promise<void> | void,
  onProfileCreate?: (profileId: string) => Promise<void> | void,
  onProfileDelete?: (profileId: string) => Promise<void> | void,
  onProfileRename?: (profileId: string) => Promise<void> | void,
  onSignIn?: (profileId: string) => Promise<void> | void,
  readUsage?: (filter: UsageFilter) => UsageTotals,
  readQuotas?: () => Promise<AccountQuota[]>,
  readBreakdown?: (filter: UsageFilter) => UsageBreakdown[],
  readFilterOptions?: (filter: UsageFilter) => UsageFilterOptions,
  readDaily?: (filter: UsageFilter, options?: UsageDailyOptions) => UsageDaily[],
  onExport?: (format: UsageExportFormat, filter: UsageFilter) => Promise<void> | void,
  readUsageHealth?: () => UsageHealth,
  runKeepAlive?: () => Promise<void> | void,
): void {
  const add = vscode.commands.registerCommand("cma.addAccount", async () => {
    const name = await vscode.window.showInputBox({ prompt: "Account Name" });
    if (!name) return;
    const profile = await repository.createProfile(name);
    await onProfileCreate?.(profile.id);
    provider.refresh();
    if (
      (await vscode.window.showInformationMessage(
        `Account "${profile.name}" created. Sign in now?`,
        "Sign In",
      )) === "Sign In"
    )
      await vscode.commands.executeCommand("cma.signIn", profile.id);
  });
  const refresh = vscode.commands.registerCommand("cma.refresh", () => provider.refresh());
  const settings = vscode.commands.registerCommand("cma.openSettings", () =>
    vscode.commands.executeCommand("workbench.action.openSettings", "cma.quotaNetworkAccess"),
  );
  const usage = vscode.commands.registerCommand("cma.showUsage", () =>
    UsagePanel.show(
      context.extensionUri,
      readUsage ?? (() => zeroUsageTotals()),
      readQuotas ?? (async () => []),
      async () => {
        const [profiles, state] = await Promise.all([
          repository.listProfiles(),
          readStateFile(repository.paths.statePath),
        ]);
        return profiles.map((profile) => ({
          profileId: profile.id,
          name: profile.name,
          selected: state.selectedProfileId === profile.id,
        }));
      },
      readBreakdown ?? (() => []),
      readFilterOptions ?? (() => ({ models: [], workingDirectories: [] })),
      readDaily ?? (() => []),
      vscode.workspace
        .getConfiguration("cma")
        .get<WorkingDirectoryDisplay>("workingDirectoryDisplay", "full"),
      onExport,
      context.globalState,
      runKeepAlive,
      () => vscode.workspace.getConfiguration("cma").get<ModelPricingTable>("modelPricing", {}),
    ),
  );
  const exportUsage = vscode.commands.registerCommand("cma.exportUsage", async () => {
    if (!onExport) return;
    const format = await vscode.window.showQuickPick(
      [
        { label: "CSV", value: "csv" as const },
        { label: "JSON", value: "json" as const },
      ],
      { placeHolder: "Export format" },
    );
    if (!format) return;
    const accounts = await repository.listProfiles();
    const account = await vscode.window.showQuickPick(
      [
        { label: "All accounts", value: "" },
        ...accounts.map((value) => ({ label: value.name, value: value.id })),
      ],
      { placeHolder: "Account filter" },
    );
    if (!account) return;
    const period = await vscode.window.showQuickPick(
      [
        { label: "Last 24 hours", days: 1 },
        { label: "Last 7 days", days: 7 },
        { label: "Last 30 days", days: 30 },
        { label: "All time", days: null },
      ],
      { placeHolder: "Period filter" },
    );
    if (!period) return;
    const options = readFilterOptions?.({}) ?? { models: [], workingDirectories: [] };
    const model = await vscode.window.showQuickPick(
      [
        { label: "All models", value: "" },
        ...options.models.map((value) => ({ label: value, value })),
      ],
      { placeHolder: "Model filter" },
    );
    if (!model) return;
    const directory = await vscode.window.showQuickPick(
      [
        { label: "All projects", value: "" },
        ...options.workingDirectories.map((value) => ({ label: value, value })),
      ],
      { placeHolder: "Project filter" },
    );
    if (!directory) return;
    const filter: UsageFilter = {};
    if (period.days !== null) {
      const until = new Date();
      const from = new Date(until);
      from.setTime(until.getTime() - period.days * 86_400_000);
      filter.from = from.toISOString();
      filter.until = until.toISOString();
    }
    Object.assign(filter, {
      ...(account.value ? { profileId: account.value } : {}),
      ...(model.value ? { model: model.value } : {}),
      ...(directory.value ? { workingDirectory: directory.value } : {}),
    });
    await onExport(format.value, filter);
  });
  const enableAuth = vscode.commands.registerCommand("cma.enableFileAuth", async () => {
    const answer = await vscode.window.showWarningMessage(
      "CMA needs file-backed Codex authentication to switch accounts. Update config.toml?",
      { modal: true },
      "Enable",
    );
    if (answer === "Enable")
      await new CodexConfigService(repository.paths.configPath).enableFileBackedAuth();
  });
  const diagnostics = vscode.commands.registerCommand("cma.diagnostics", async () => {
    const health = readUsageHealth?.();
    const value = await new DiagnosticsService(repository.paths, {
      watcherHealth: health?.watcherHealth,
      parserFailureCount: health?.parserFailureCount,
      usageDegraded: health?.degraded,
    }).collect();
    await vscode.env.clipboard.writeText(JSON.stringify(value, null, 2));
    void vscode.window.showInformationMessage("CMA diagnostics copied to the clipboard.");
  });
  const clearStaleLock = vscode.commands.registerCommand("cma.clearStaleLock", async () => {
    const lock = new LockService(repository.paths.switchLockPath);
    const info = await lock.readInfo();
    if (!info) {
      void vscode.window.showInformationMessage("No account switch lock exists.");
      return;
    }
    if (!(await lock.isStale())) {
      void vscode.window.showWarningMessage(
        "The account switch lock is still active or ambiguous.",
      );
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `Clear the stale account switch lock from ${info.host} (PID ${info.pid})?`,
      { modal: true },
      "Clear Lock",
    );
    if (answer !== "Clear Lock") return;
    void vscode.window.showInformationMessage(
      (await lock.clearStale())
        ? "Stale account switch lock cleared."
        : "The lock changed; nothing was cleared.",
    );
  });
  const signIn = vscode.commands.registerCommand(
    "cma.signIn",
    async (item?: AccountTreeItem | string) => {
      const profileId = typeof item === "string" ? item : item?.profileId;
      if (!profileId) return;
      if (!(await ensureFileBackedAuth(repository))) return;
      const binaryPath = vscode.workspace
        .getConfiguration("cma")
        .get<string>("codexBinaryPath")
        ?.trim();
      await new SignInService(repository).signIn(profileId, {
        ...(binaryPath ? { binaryPath } : {}),
        onLoginUrl: (url, cancel) => {
          void Promise.resolve(
            vscode.window.showInformationMessage(
              "Open the Codex sign-in link?",
              "Cancel",
              "Copy Link",
              "Open in Browser",
            ),
          )
            .then(async (choice) => {
              if (choice === "Copy Link") await vscode.env.clipboard.writeText(url);
              else if (choice === "Open in Browser")
                await vscode.env.openExternal(vscode.Uri.parse(url));
              else cancel();
            })
            .catch(() => cancel());
        },
      });
      await onSignIn?.(profileId);
      provider.refresh();
      if (
        (await vscode.window.showInformationMessage(
          "Account signed in. Select it now?",
          "Select Account",
        )) === "Select Account"
      )
        await vscode.commands.executeCommand("cma.selectAccount", profileId);
    },
  );
  const select = vscode.commands.registerCommand(
    "cma.selectAccount",
    async (item?: AccountTreeItem | string) => {
      const id =
        typeof item === "string" ? item : (item?.profileId ?? (await chooseSignedIn(repository)));
      if (!id) return;
      if (!(await ensureFileBackedAuth(repository))) return;
      await new SwitchService({
        repository,
        reload: () => new CodexReloadService().requestReload(),
        recordInterval: onSwitch,
      }).switchTo(id);
      provider.refresh();
    },
  );
  const rename = vscode.commands.registerCommand(
    "cma.renameAccount",
    async (item?: AccountTreeItem) => {
      if (!item) return;
      const name = await vscode.window.showInputBox({
        prompt: "Account Name",
        value: item.label?.toString(),
      });
      if (!name) return;
      const updated = await new LockService(repository.paths.switchLockPath).withLock(() =>
        repository.renameProfile(item.profileId, name),
      );
      const state = await readStateFile(repository.paths.statePath);
      if (state.selectedProfileId === updated.id)
        await writeStateFile(repository.paths.statePath, {
          ...state,
          selectedProfileSlug: updated.slug,
        });
      await onProfileRename?.(updated.id);
      provider.refresh();
    },
  );
  const signOut = vscode.commands.registerCommand("cma.signOut", async (item?: AccountTreeItem) => {
    if (
      !item ||
      (await vscode.window.showWarningMessage(
        `Sign out of "${String(item.label)}"?`,
        { modal: true },
        "Sign Out",
      )) !== "Sign Out"
    )
      return;
    if (!(await ensureFileBackedAuth(repository))) return;
    await new SignOutService({
      repository,
      closeInterval: onSignOut,
      reload: () => new CodexReloadService().requestReload(),
    }).signOut(item.profileId);
    provider.refresh();
  });
  const remove = vscode.commands.registerCommand(
    "cma.deleteAccount",
    async (item?: AccountTreeItem) => {
      if (
        !item ||
        (await vscode.window.showWarningMessage(
          `Delete "${String(item.label)}"? Usage history is retained.`,
          { modal: true },
          "Delete",
        )) !== "Delete"
      )
        return;
      const lock = new LockService(repository.paths.switchLockPath);
      await lock.withLock(async () => {
        const state = await readStateFile(repository.paths.statePath);
        const needsSignOut =
          state.selectedProfileId === item.profileId ||
          (await repository.profileAuthExists(item.profileId));
        const signOut = new SignOutService({
          repository,
          lock,
          closeInterval: onSignOut,
          reload: () => new CodexReloadService().requestReload(),
        });
        if (needsSignOut) {
          if (!(await ensureFileBackedAuth(repository))) return;
          await signOut.signOutWithLockHeld(item.profileId);
        }
        await repository.deleteProfile(item.profileId);
        await onProfileDelete?.(item.profileId);
      });
      provider.refresh();
    },
  );
  context.subscriptions.push(
    add,
    refresh,
    settings,
    usage,
    enableAuth,
    diagnostics,
    clearStaleLock,
    exportUsage,
    signIn,
    select,
    rename,
    signOut,
    remove,
  );
}

async function ensureFileBackedAuth(repository: AccountRepository): Promise<boolean> {
  const config = new CodexConfigService(repository.paths.configPath);
  if (await config.isFileBackedAuthReady()) return true;
  const choice = await vscode.window.showWarningMessage(
    "Account operations require file-backed Codex authentication.",
    { modal: true },
    "Enable File-backed Auth",
  );
  if (choice !== "Enable File-backed Auth") return false;
  await vscode.commands.executeCommand("cma.enableFileAuth");
  return config.isFileBackedAuthReady();
}

function zeroUsageTotals(): UsageTotals {
  return { inputTokens: 0n, cachedInputTokens: 0n, outputTokens: 0n };
}

async function chooseSignedIn(repository: AccountRepository): Promise<string | undefined> {
  const profiles = await repository.listProfiles();
  const signedIn = [];
  for (const profile of profiles)
    if (await repository.profileAuthExists(profile.id)) signedIn.push(profile);
  const picked = await vscode.window.showQuickPick([
    { label: "$(add) Add Account", id: "__add__" },
    ...signedIn.map((profile) => ({ label: profile.name, id: profile.id })),
  ]);
  if (picked?.id === "__add__") {
    await vscode.commands.executeCommand("cma.addAccount");
    return undefined;
  }
  return picked?.id;
}
