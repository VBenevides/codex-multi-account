import * as vscode from "vscode";

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor() {
    this.item.command = "cma.selectAccount";
    this.item.show();
  }

  setProfile(name?: string, warning = false): void {
    this.item.text = name ? `${warning ? "$(warning)" : "$(account)"} ${name}` : "$(account) CMA";
    this.item.tooltip = warning ? "CMA account state needs attention" : "Codex Multi Account";
  }

  dispose(): void {
    this.item.dispose();
  }
}
