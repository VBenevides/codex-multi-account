import * as vscode from "vscode";
import type { AccountState } from "../accounts/accountTypes.js";

export class AccountTreeItem extends vscode.TreeItem {
  readonly profileId: string;

  constructor(state: AccountState) {
    super(state.profile.name, vscode.TreeItemCollapsibleState.None);
    this.profileId = state.profile.id;
    this.command = {
      command: "cma.selectAccount",
      title: "Select Account",
      arguments: [state.profile.id],
    };
    this.description = state.profile.identity?.email
      ? `- ${state.profile.identity.email}`
      : state.signedIn
        ? "Signed in"
        : "Signed out";
    this.tooltip = [state.profile.name, this.description].filter(Boolean).join("\n");
    this.contextValue = contextValue(state);
    this.iconPath = new vscode.ThemeIcon(
      state.selected ? "check" : state.signedIn ? "account" : "circle-slash",
    );
  }
}

function contextValue(state: AccountState): string {
  if (state.selected && !state.liveAuthMatches) return "cma.account.current.mismatch";
  if (state.selected)
    return state.signedIn ? "cma.account.current.signedIn" : "cma.account.current.signedOut";
  return state.signedIn ? "cma.account.signedIn" : "cma.account.signedOut";
}
