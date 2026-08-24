# CMA Public Release Security Audit

Audit date: 2026-08-16

Baseline: `8148139` (public release gate implementation)

## Verdict

The implemented security gate has no remaining supported High-severity code
finding. Do not publish the current build yet because native integration is
blocked and live Codex behavior remains unverified.

The audit found no supported remote code execution or arbitrary shell injection.
The extension can read password-equivalent Codex credentials by design. Quota
uploads are now disabled by default, but an opt-in `all` setting can still send
every stored access token to the hard-coded ChatGPT quota endpoint.

Personal use is reasonable from a trusted build when the user accepts the quota
upload.

## Verification

| Check | Result |
| --- | --- |
| `npm run check` | PASS. 17 test files passed. |
| `npm run scan:secrets` | PASS. |
| `npm run package` | PASS. VSIX created. |
| `npm run test:integration` | BLOCKED by DNS for `update.code.visualstudio.com`. |
| Runtime dependencies | None. `npm ls --omit=dev` is empty. |

The native Codex login, account switch, reload, and quota calls were not tested
against live accounts.

## Available features

- Manage local account profiles and staged Codex sign-in.
- Store profile credentials under `~/.codex/cma/accounts`.
- Atomically switch the live `~/.codex/auth.json`.
- Require file-backed Codex authentication for account operations.
- Track local token-count events from Codex rollout files.
- Group and filter usage by account, model, and working directory.
- Show quota results, daily charts, exports, diagnostics, and recovery commands.
- Remove old login staging directories and reject profile-auth symlinks.

## Security findings

### S-1 — Resolved: login URL validation accepts only exact hosts

Impact / Severity Level: High before fix

Evidence:

- `src/accounts/signInService.ts:19-36` parses URL candidates and requires
  HTTPS, an exact host, no port, and no user-info.
- `src/commands/registerCommands.ts:197-210` opens the accepted URL externally.
- `test/services.test.ts:21-31` covers user-info, suffix-host, and HTTP cases.

Description: The previous prefix matcher allowed a malicious or compromised
Codex binary to print a phishing URL. The matcher now rejects those variants.

Resolution: Implemented in `7c0b7cebfeabf2621a39a59b47482e8c52ea7bad`.

### S-2 — Opt-in quota checks can send every stored access token

Impact / Severity Level: Medium

Evidence:

- `src/extension.ts:35-38` defaults `quotaNetworkAccess` to `disabled`.
- `src/usage/quotaService.ts:71-95` reads every signed-in profile and sends a
  bearer token to `https://chatgpt.com/backend-api/wham/usage`.
- `README.md:7` documents this behavior.

Description: Opening or refreshing Usage can transmit credentials for all
profiles when the user selects `all`. This is an accepted opt-in for the
current user, but it needs clear scope and endpoint disclosure.

Suggested Modification: Keep `disabled` as the default. Show the exact
endpoint and account scope in Settings and keep the all-account mode explicit.

### S-3 — Privacy policy data flow

Impact / Severity Level: Low

Evidence:

- `PRIVACY.md:4` now states that quota uploads are disabled by default.
- `src/usage/quotaService.ts:81-85` sends access tokens to ChatGPT.

Description: The privacy policy now describes the endpoint, account scope, and
opt-in setting. Keep this text synchronized with the manifest.

Suggested Modification: Add a regression check if the quota policy changes.

### S-4 — Resolved: identity matching trusts unsigned JWT claims

Impact / Severity Level: Medium

Evidence:

- `src/accounts/accountIdentity.ts` keeps JWT claims separate from structured
  identity fields.
- `src/accounts/authSyncService.ts`, `src/accounts/reconciliationService.ts`,
  and `src/accounts/signOutService.ts` use structured fields for ownership.

Description: The previous code could authorize ownership from forged JWT
claims. The current code keeps those claims for display only.

Resolution: Implemented in `82fb6cf99f65f39e8b8dccf848578a03cb052994`.

## Bugs and release gaps

### B-1 — Native integration remains unverified

Impact / Severity Level: Medium

Evidence: `npm run test:integration` cannot download the VS Code test runtime
because DNS resolution for `update.code.visualstudio.com` fails.

Suggested Modification: Run the smoke test on a networked machine and verify
sign-in, account switching, reload, shared Codex state, MCPs, and usage scans.

### B-2 — Resolved: login URL tests cover hostile hosts

Impact / Severity Level: Medium

Evidence: `test/services.test.ts:21-31` tests valid origins, user-info,
suffix-host, and HTTP variants.

Resolution: Implemented in `7c0b7cebfeabf2621a39a59b47482e8c52ea7bad`.

### B-3 — Resolved: the VSIX includes development files

Impact / Severity Level: Low

Evidence: `unzip -Z1 codex-account-manager-0.1.0.vsix` now lists only release
documents, assets, `package.json`, and `dist/extension.js`.

Resolution: Implemented in `731ad558975795fda0912e8134e1a6f99b1b1744`.

## Potential new features

- Add a first-run security screen for quota network access.
- Add a command to inspect the exact data flow without sending credentials.
- Add signed-release checks and a reproducible package manifest.
- Add automated tests for URL parsing, privacy policy text, and VSIX contents.

## Enhancements

- Pin quota requests to HTTPS with `redirect: "error"` and strict response
  validation.
- Cap quota response size before JSON parsing.
- Publish a threat model that states the local-attacker limits.
- Run native VS Code tests on every claimed operating system.
