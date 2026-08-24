import { watch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { AccountRepository } from "../accounts/accountRepository.js";
import type { AccountState } from "../accounts/accountTypes.js";
import { readStateFile } from "../accounts/accountService.js";
import { parseAuthFile } from "../accounts/authFile.js";
import { AccountTreeItem } from "./accountTreeItem.js";

class AccountsSectionTreeItem extends vscode.TreeItem {
  constructor() {
    super("Accounts", vscode.TreeItemCollapsibleState.Expanded);
    this.description = "+";
    this.command = { command: "cma.addAccount", title: "Add Account" };
    this.tooltip = "Add Account";
    this.contextValue = "cma.accounts.section";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

class ShowUsageTreeItem extends vscode.TreeItem {
  constructor() {
    super("Show Usage", vscode.TreeItemCollapsibleState.None);
    this.command = { command: "cma.showUsage", title: "Show Usage" };
    this.tooltip = "Show Usage";
    this.contextValue = "cma.usage";
    this.iconPath = new vscode.ThemeIcon("graph");
  }
}

export class AccountsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly watchers: FSWatcher[] = [];
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly repository = new AccountRepository()) {}

  refresh(): void {
    this.changed.fire();
  }

  async startWatching(): Promise<void> {
    await mkdir(this.repository.paths.accountsHome, { recursive: true, mode: 0o700 });
    this.watchers.push(
      watch(this.repository.paths.accountsHome, () => this.refresh()),
      watch(this.repository.paths.cmaHome, (_event, filename) => {
        if (!filename || filename.toString() === path.basename(this.repository.paths.statePath))
          this.refresh();
      }),
      watch(path.dirname(this.repository.paths.liveAuthPath), (_event, filename) => {
        if (!filename || filename.toString() === path.basename(this.repository.paths.liveAuthPath))
          this.refresh();
      }),
    );
  }

  dispose(): void {
    for (const watcher of this.watchers.splice(0)) watcher.close();
    this.changed.dispose();
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) return [new ShowUsageTreeItem(), new AccountsSectionTreeItem()];
    if (!(element instanceof AccountsSectionTreeItem)) return [];

    const [profiles, state] = await Promise.all([
      this.repository.listProfiles(),
      readStateFile(this.repository.paths.statePath),
    ]);
    const items = await Promise.all(
      profiles.map(async (profile) => {
        const signedIn = await this.repository.profileAuthExists(profile.id);
        let liveAuthMatches = false;
        if (signedIn && state.selectedProfileId === profile.id) {
          try {
            const live = parseAuthFile(
              await (await import("node:fs/promises")).readFile(this.repository.paths.liveAuthPath),
            );
            const stored = parseAuthFile(await this.repository.readProfileAuth(profile.id));
            liveAuthMatches = live.fingerprint.value === stored.fingerprint.value;
          } catch {
            liveAuthMatches = false;
          }
        }
        const accountState: AccountState = {
          profile,
          signedIn,
          selected: state.selectedProfileId === profile.id,
          liveAuthMatches,
        };
        return new AccountTreeItem(accountState);
      }),
    );
    return items;
  }
}
