# CMA privacy and local threat model

- CMA stores account profiles, copied Codex credentials, state, and usage data locally under `~/.codex/cma`.
- CMA does not send authentication tokens by default. If the user enables `cma.quotaNetworkAccess`, CMA sends access tokens to `https://chatgpt.com/backend-api/wham/usage` for the selected account or all signed-in accounts, based on the setting. The native Codex login may also contact OpenAI when the user explicitly signs in.
- When active, CMA checks each signed-in profile's current quota and invokes the native Codex CLI with that profile's credentials when its daily reset is 4h58m, 4h59m, or 5h away. This keep-alive intentionally starts the account's rolling 5-hour refresh window before the account is selected or otherwise used. It requests 1000 repetitions of `Hi` and consumes the account's quota.
- The usage database contains profile IDs, names, safe identity metadata, token counts, timestamps, rollout paths, and session IDs. It does not contain auth tokens or rollout conversation content.
- The webview receives token totals, quota results, safe account labels, and token-only interaction rows. It never receives auth credentials or conversation content.
- Auth files are password-equivalent secrets. CMA avoids logging them, avoids SQLite storage, uses private staging directories, and refuses unexpected symlinks on secret mutation paths.
- A local attacker who can read the user's home directory can read the stored profile credentials; CMA is not an encrypted credential vault.
