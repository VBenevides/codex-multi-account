import * as vscode from "vscode";

export class CodexReloadService {
  async requestReload(): Promise<void> {
    await vscode.window.showInformationMessage(
      "CMA switched the Codex account. Reload VS Code to use it.",
      "Reload Window",
    );
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}
