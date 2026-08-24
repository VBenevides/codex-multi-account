# Auth switching spike

Date: 2026-08-16

The Codex CLI is discoverable at `/home/wdtg/.local/bin/codex` and reports `codex-cli 0.145.0`. The real live auth file exists, but its contents were not read or copied during this spike. `~/.codex/config.toml` exists and the current configured storage mode is `auto`; CMA therefore does not assume file-backed switching is ready.

The automated implementation uses `CODEX_HOME` staging for login and atomic replacement of `~/.codex/auth.json`. It preserves `config.toml` and does not touch sessions or MCP data. A full live account-switch test was not run because it requires two synthetic profiles, a VS Code Extension Development Host, and deliberately mutating the user's Codex auth cache. Reload behavior remains a manual acceptance test. CMA keeps full-window reload as the v0 fallback and does not invoke undocumented native commands.

Manual follow-up:

- create two disposable test profiles under an isolated `CODEX_HOME`;
- configure `cli_auth_credentials_store = "file"` in that isolated home;
- verify native Codex behavior, MCP loading, and conversation continuity after a reload;
- record the result before release.
