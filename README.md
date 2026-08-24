# Codex Multi Account

<p align="center">
  <img src="assets/icon.png" alt="Codex Multi Account icon" width="160">
</p>

<p align="center">
  <a href="https://github.com/VBenevides/codex-multi-account/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/VBenevides/codex-multi-account?sort=semver"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/VBenevides/codex-multi-account"></a>
  <a href="https://github.com/VBenevides/codex-multi-account/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/VBenevides/codex-multi-account/actions/workflows/codeql.yml/badge.svg"></a>
  <a href="https://github.com/VBenevides/codex-multi-account/actions/workflows/security.yml"><img alt="Dependency security" src="https://github.com/VBenevides/codex-multi-account/actions/workflows/security.yml/badge.svg"></a>
</p>

CMA manages local Codex authentication profiles and displays token totals observed in local Codex rollout files. It works alongside the native Codex VS Code extension; it does not implement chat or replace Codex.

## Security

Authentication files are password-equivalent secrets. CMA stores them only under `~/.codex/cma/accounts`, never logs them, and never stores them in SQLite or a webview. Quota checks are disabled by default. If enabled in Settings under `CMA: Quota Network Access`, CMA sends access tokens only to `https://chatgpt.com/backend-api/wham/usage`; choose `selected` or `all` to opt in. Do not commit a real `auth.json`; use synthetic fixtures only.

Account switching requires Codex file-backed authentication and performs a safe atomic replacement of `~/.codex/auth.json`. A VS Code window reload may be required for the native extension to observe the new account.

Usage totals are local observations from rollout events. They may not equal ChatGPT subscription quota, billing, or server-side rate-limit accounting.

## Account switching

CMA keeps one profile directory per account under `~/.codex/cma/accounts`. Sign-in uses a private staging `CODEX_HOME`; the native Codex CLI remains responsible for the browser/device login. Switching atomically replaces `~/.codex/auth.json`, preserves the shared `config.toml` and MCP settings, and asks VS Code to reload so the native Codex extension can observe the change. CMA refuses unexpected symlinks on profile and auth mutation paths.

After sign-out, the profile name and safe identity metadata may remain so usage history and the account list stay useful. Stored credentials are removed.

## Usage data

The Usage view defaults to the last 30 days and can filter by period, account, model, or working directory. It reads token-count events from `~/.codex/sessions`, stores only token counts, timestamps, rollout identifiers, and safe account metadata in SQLite, and does not store rollout conversation content. Existing session files are imported on first startup; persisted account-switch intervals attribute historical events when possible. Use `CMA: Export Usage` for token-only CSV or JSON output. Working-directory display can be full, home-relative, or basename-only; filtering still uses the exact stored value.

## Troubleshooting

- Enable file-backed auth with `CMA: Enable File-backed Auth` if switching is unavailable.
- Use `CMA: Diagnostics` to copy redacted environment and database health details.
- Use `CMA: Repair Selected Profile State` when the live account and selected profile disagree.
- Use `CMA: Rebuild Usage Database` only after making a backup; it removes the local usage database and rebuilds it from rollout files.
- If the native extension still shows the old account, run `Developer: Reload Window`.

## Remote and WSL

Install CMA in the same VS Code extension host as the native Codex extension. CMA resolves that host's `os.homedir()` and therefore reads the remote/WSL `~/.codex` when running remotely; the browser/device login still opens on the client according to VS Code's remote environment.

## Uninstall

Uninstalling the extension does not remove `~/.codex/cma` or native Codex files. Delete that directory manually only after backing up any profiles or usage history you want to keep. To remove CMA's credentials, sign out profiles first or securely remove the profile directories.

Version 0.1.0 targets VS Code 1.102 or newer so the extension host provides the built-in SQLite driver.

## Development

```sh
npm install
npm run check
npm run build
npm run package
# Build and install the current VSIX in VS Code
./dev-install.sh
```
