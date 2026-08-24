# TODO.md — Codex Account Manager (CMA)

> Ordered implementation checklist for the VS Code extension described in `PLAN.md`.

> Working-tree evidence note: automated implementation is recorded in the implementation commits listed below. Manual, platform, native-Codex, and post-MVP items remain unchecked.

## Milestone 0 — Repository and technical spikes

- [x] Create extension repository.
- [x] Initialize TypeScript VS Code extension.
- [x] Add ESLint.
- [x] Add formatter.
- [x] Add unit-test runner.
- [x] Add VS Code integration-test runner.
- [x] Add bundler (`esbuild` or equivalent).
- [x] Add `@vscode/vsce` packaging.
- [x] Decide minimum supported VS Code version.
- [x] Add CI workflow for lint, test, build, package.
- [x] Add fake-secret scanning to CI.
- [x] Add `.gitignore` entries for local auth fixtures and build output.
- [x] Add `.vscodeignore`.
- [x] Document that no real `auth.json` may enter the repository.

  - Verification: `npm run check`; `npm run package`; `npm run scan:secrets`.
  - Result: PASS — checks and VSIX packaging pass. Integration runner is configured but live execution is blocked by DNS access to `update.code.visualstudio.com`.
  - Implementation commit: `91adb89a1894a6e639b8c6be1deb61fac97cbf7c`

### Spike A — Codex auth switching

- [x] Confirm the current Codex CLI is installed/discoverable.
- [ ] Confirm `~/.codex/auth.json` is used when `cli_auth_credentials_store = "file"`.
- [ ] Create two **test** account profiles manually.
- [ ] Switch live `~/.codex/auth.json` between test profiles.
- [ ] Reload VS Code.
- [ ] Verify native Codex extension reports/uses the intended account.
- [ ] Verify `~/.codex/config.toml` is unchanged.
- [ ] Verify MCPs continue loading.
- [ ] Verify an existing local conversation remains present after the switch.
- [ ] Record whether a full VS Code reload is required.
- [ ] Record any native Codex command/API that safely reloads auth, but do not depend on undocumented commands for MVP.
- [x] Write `docs/spike-auth.md`.

  - Verification: `codex --version`; non-secret config/auth existence checks; `docs/spike-auth.md`.
  - Result: PASS for CLI discovery/documentation; live auth-switch validation remains isolated/manual.
  - Implementation commit: `91adb89a1894a6e639b8c6be1deb61fac97cbf7c`

### Spike B — Token usage rollouts

- [ ] Locate the active `~/.codex/sessions/**/rollout-*.jsonl`.
- [ ] Generate a few native Codex interactions.
- [ ] Confirm new `event_msg/token_count` records appear.
- [x] Capture **sanitized synthetic equivalents**, not real conversation data, as test fixtures.
- [x] Verify fields:
  - [x] `timestamp`
  - [x] `info.total_token_usage.input_tokens`
  - [x] `info.total_token_usage.cached_input_tokens`
  - [x] `info.total_token_usage.output_tokens`
  - [x] `info.last_token_usage`
- [x] Reproduce or fixture a repeated `last_token_usage` event with unchanged cumulative total.
- [x] Confirm delta-by-cumulative logic avoids overcount.
- [ ] Verify behavior across conversation resume.
- [ ] Verify behavior after account switch in the same conversation.
- [x] Write `docs/spike-usage.md`.

  - Verification: `npm test`; `test/fixtures/rollout-token-count.jsonl`; `docs/spike-usage.md`.
  - Result: PASS — synthetic parser, duplicate, reset, and SQLite tests pass; live Codex generation remains manual.
  - Implementation commit: `91adb89a1894a6e639b8c6be1deb61fac97cbf7c`

### Exit criteria

- [ ] Auth switching is proven.
- [ ] Token-count ingestion is proven.
- [ ] Any differences from `PLAN.md` are updated before main implementation.

---

## Milestone 1 — Paths, filesystem, and profile model

### Paths

- [x] Create `src/config/paths.ts`.
- [x] Resolve user home with `os.homedir()`.
- [x] Define:
  - [x] `codexHome = ~/.codex`
  - [x] `liveAuthPath = ~/.codex/auth.json`
  - [x] `configPath = ~/.codex/config.toml`
  - [x] `cmaHome = ~/.codex/cma`
  - [x] `accountsHome = ~/.codex/cma/accounts`
  - [x] `usageDbPath = ~/.codex/cma/usage.sqlite`
  - [x] `statePath = ~/.codex/cma/state.json`
  - [x] `switchLockPath = ~/.codex/cma/switch.lock`
- [x] Add path traversal tests.
- [x] Add Windows path tests.
- [x] Add Unix path tests.
- [x] Add remote/WSL diagnostic for resolved home.

### Secure filesystem helpers

- [x] Create `src/infra/atomicFile.ts`.
- [x] Implement atomic JSON write to sibling temp + rename.
- [x] Implement atomic binary/text copy.
- [x] Implement rollback helper.
- [x] Implement restrictive file permission helper.
- [x] Unix: create CMA directories with `0700` where possible.
- [x] Unix: create auth files with `0600` where possible.
- [x] Never chmod shared `~/.codex` content unnecessarily.
- [x] Add tests for interrupted write simulation.
- [x] Add tests for rollback.

### Profile types

- [x] Create `AccountProfile` interface.
- [x] Add stable profile UUID.
- [x] Add display `name`.
- [x] Add filesystem `slug`.
- [x] Add timestamps.
- [x] Add optional identity metadata:
  - [x] email/account address
  - [x] ChatGPT user ID
  - [x] account ID
- [x] Add profile schema version.

### Account-name validation

- [x] Reject empty names.
- [x] Reject `.`.
- [x] Reject `..`.
- [x] Reject path separators.
- [x] Reject NUL/control characters.
- [x] Handle Windows reserved filenames.
- [x] Generate deterministic safe slug.
- [x] Handle duplicate slugs.
- [x] Define maximum length.
- [x] Allow Unicode display names.
- [x] Add unit tests.

### Profile repository

- [x] Create `src/accounts/accountRepository.ts`.
- [x] `listProfiles()`.
- [x] `getProfile(id)`.
- [x] `getProfileBySlug(slug)`.
- [x] `createProfile(name)`.
- [x] `renameProfile(id, newName)`.
- [x] `deleteProfile(id)`.
- [x] `profileAuthExists(id)`.
- [x] `readProfileAuth(id)` without logging contents.
- [x] `writeProfileAuth(id, bytes)` atomically.
- [x] `deleteProfileAuth(id)`.
- [x] Reconcile `profile.json` with directory slug.
- [x] Handle malformed profile metadata.
- [x] Add unit tests.

### CMA state

- [x] Define `state.json` schema.
- [x] Add state version.
- [x] Add selected profile ID.
- [x] Add selected profile slug.
- [x] Add selected timestamp.
- [x] Add last observed live-auth fingerprint.
- [x] Implement atomic state repository.
- [x] Add migration/default behavior for missing state.
- [x] Add tests.

  - Verification: `npm test`.
  - Result: PASS — profile, path, atomic-file, state, and repository tests pass.
  - Implementation commit: `91adb89a1894a6e639b8c6be1deb61fac97cbf7c`

---

## Milestone 2 — Codex auth/config compatibility

### Config inspection

- [x] Create `src/config/codexConfigService.ts`.
- [x] Detect whether `~/.codex/config.toml` exists.
- [x] Detect effective/configured `cli_auth_credentials_store`.
- [x] Distinguish:
  - [x] `file`
  - [x] `keyring`
  - [x] `auto`
  - [x] unknown/missing
- [x] Add `isFileBackedAuthReady()`.

### Enable file-backed auth

- [x] Add command `CMA: Enable File-backed Auth`.
- [x] Require explicit confirmation.
- [x] Preserve existing config content/comments as much as practical.
- [x] Do not rewrite MCP sections.
- [x] Create backup before modification.
- [x] Set:
  ```toml
  cli_auth_credentials_store = "file"
  ```
- [x] Re-read and verify.
- [x] Roll back on failure.
- [x] Add tests with complex TOML/MCP fixtures.
- [x] Add tests proving MCP content remains byte-equivalent except intended edit if possible.

### Auth file model

- [x] Create `src/accounts/authFile.ts`.
- [x] Parse auth JSON without printing it.
- [x] Minimum structural validation.
- [x] Detect auth mode.
- [x] Extract safe identity metadata when present.
- [x] Compute SHA-256 fingerprint.
- [x] Ensure thrown errors contain no token values.
- [x] Add redaction tests.

### Optional identity extraction

- [x] Prefer structured identity fields when present.
- [x] Extract email/account address if available.
- [x] Extract account/user IDs if available.
- [x] If JWT payload fallback is implemented:
  - [x] decode locally only;
  - [x] never treat decoded claims as verified security facts;
  - [x] never log raw JWT;
  - [x] add tests with fake JWT only.
- [x] Gracefully support unknown email.

  - Verification: `npm test`; `npm run check`.
  - Result: PASS — config preservation, file-backed mode detection, auth validation, identity extraction, fingerprinting, and redaction tests pass.
  - Implementation commit: `91adb89a1894a6e639b8c6be1deb61fac97cbf7c`

---

## Milestone 3 — Locking and account-switch transaction

### Inter-process lock

- [x] Create `src/accounts/lockService.ts`.
- [x] Acquire lock via exclusive file creation.
- [x] Store PID/host/timestamp.
- [x] Release in `finally`.
- [x] Detect obvious stale locks.
- [x] Add conservative stale-lock timeout.
- [x] Add command `CMA: Clear Stale Lock`.
- [x] Require confirmation before clearing ambiguous lock.
- [x] Add two-process/mocked concurrency tests.
  - Verification: `npm run check`
  - Result: PASS — stale-lock clearing is guarded by liveness/age checks and modal confirmation; lock recovery regression test passes.
  - Implementation commit: `7b6fdc9329729caf2dae8b6c0205789b983a565b`

### Live auth synchronization

- [x] Create `src/accounts/authSyncService.ts`.
- [x] Watch `~/.codex/auth.json`.
- [x] Debounce file changes.
- [x] Fingerprint before copying.
- [x] Identify currently selected profile.
- [x] Verify identity/ownership before sync.
- [x] Atomically sync live auth to selected profile.
- [x] Update last observed fingerprint.
- [x] Never overwrite a profile when identity is ambiguous.
- [x] Add startup reconciliation.
- [x] Add shutdown best-effort sync.
- [x] Add tests for a Codex token refresh rewriting the live auth.
- [x] Add tests for external account replacement.
- [x] Add tests for deleted live auth.
  - Verification: `npm run check`
  - Result: PASS — refreshes sync to the selected profile; ambiguous external replacement is rejected; missing live auth is reported without overwriting stored credentials.
  - Implementation commit: `39b8da6`

### Startup reconciliation

- [x] Current state + live auth match selected profile -> sync.
- [x] Live auth matches another known profile -> detect mismatch.
- [x] Offer safe repair of selected state.
- [x] Live auth matches no profile -> show unmanaged account state.
- [x] Add `Import Current Codex Account`.
- [x] Import never changes the live auth.
- [x] Add tests.
  - Verification: `npm run check`
  - Result: PASS — reconciliation classifies selected, known, unmanaged, missing, and invalid live-auth states; import/repair never mutates live auth.
  - Implementation commit: `3e6de7845aa343e829fe6311c9446508ce8005bc`

### Switch service

- [x] Create `src/accounts/switchService.ts`.
- [x] Validate target exists.
- [x] Validate target is signed in.
- [x] Acquire lock.
- [x] Sync current live auth to current profile first.
- [x] Re-read target auth after lock acquisition.
- [x] Validate target auth.
- [x] Create rollback copy of live auth.
- [x] Write `auth.json.cma-next`.
- [x] Apply secure permissions.
- [x] Atomically rename over `~/.codex/auth.json`.
- [x] Re-read and verify target fingerprint.
- [x] Update selected profile in state.
- [x] Record switch interval in SQLite when DB is available.
- [x] Remove rollback temp.
- [x] Release lock.
- [x] Trigger reload UX.
- [x] Roll back on every failure after live auth mutation.
- [ ] Add fault-injection tests at every transaction stage.

### Reload strategy

- [x] Implement a single `CodexReloadService`.
- [x] MVP: use/recommend VS Code window reload after a successful switch.
- [x] Clearly notify user why reload is necessary.
- [x] Do not kill arbitrary Codex processes.
- [ ] Keep future native Codex adapter behind an interface.
- [ ] If an internal command is detected, treat it as optional and version-sensitive.
- [x] Always retain full-window reload fallback.

  - Verification: `npm test`; `npm run check`; `test/services.test.ts`.
  - Result: PASS — lock, config, atomic switch, rollback, state update, reload fallback, and SQLite interval hooks are implemented. Concurrency/fault-injection and live refresh tests remain unchecked.
  - Implementation commit: `91adb89a1894a6e639b8c6be1deb61fac97cbf7c`

---

## Milestone 4 — Sign In, Sign Out, Add/Edit/Delete

### Sign-in staging

- [x] Create `src/accounts/signInService.ts`.
- [x] Discover `codex` binary.
- [x] Support a user setting for custom Codex binary path.
  - Verification: `npm run check`
  - Result: PASS — `cma.codexBinaryPath` is exposed in the extension settings and passed to staged sign-in.
  - Implementation commit: `5ab7692acd05a3fe1208f4b0696a970d7fdef864`
- [x] Create random private staging directory under `~/.codex/cma/login-staging`.
- [x] Write minimal staging `config.toml`.
- [x] Force file-backed auth in staging.
- [x] Spawn Codex login without shell-string interpolation.
- [x] Make login flow visible to the user.
- [ ] Optional: add device-code sign-in action.
- [x] Wait for process completion.
- [x] Verify staging `auth.json` exists.
- [x] Validate staging auth.
- [x] Extract safe identity metadata.
- [x] Atomically save auth to profile.
- [x] Update profile metadata.
- [x] Remove staging directory.
- [x] On failure, clean staging without touching live auth.
- [x] Add process mocks/tests.
  - Verification: `npm run check`
  - Result: PASS — mocked staged sign-in stores credentials and safe identity metadata.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`

### Sign In command

- [x] Show only for signed-out profiles.
- [x] Invoke staged Codex login.
- [x] Refresh tree when done.
- [x] Do not auto-select unless explicitly chosen by product decision.
- [x] Offer `Select Account` after successful sign-in.

### Sign Out command

#### Non-selected profile

- [x] Confirm sign out.
- [x] Delete stored profile auth only.
- [x] Decide whether safe email metadata remains.
  - Result: safe identity metadata remains after sign-out so the profile and usage history stay identifiable; credentials are removed.
  - Implementation commit: `011d5ea`
- [x] Refresh UI.

#### Selected profile

- [x] Acquire switch lock.
- [x] Verify selected profile owns live auth.
- [x] Delete stored profile auth.
- [x] Delete live auth.
- [x] Close active switch interval.
- [x] Update CMA state.
- [x] Release lock.
- [x] trigger reload UX.
- [x] Add rollback/partial-failure handling.
  - Verification: `npm run check`
  - Result: PASS — selected and non-selected sign-out paths validate ownership, lock, state/auth cleanup, interval closure, reload, and rollback.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`

### Add account command

- [x] Multi-step input: Account Name.
- [x] Validate.
- [x] Create profile directory.
- [x] Create metadata only.
- [x] Refresh tree.
- [x] Offer Sign In.

### Rename account command

- [x] Prompt existing name.
- [x] Validate new name.
- [x] Acquire lock.
- [x] Rename directory safely.
- [x] Preserve profile ID.
- [x] Update state if selected.
- [x] Update SQLite profile display name/slug.
- [x] Release lock.
- [x] Refresh UI.
- [x] Add collision tests.
  - Verification: `npm run check`
  - Result: PASS — Add/Rename/Delete lifecycle commands use the shared repository, lock, metadata, state, usage, and refresh hooks.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`

### Delete account command

- [x] Confirmation includes profile name.
- [x] Do not delete usage history by default.
- [x] Non-current signed-out deletion.
- [x] Non-current signed-in deletion.
- [x] Current profile deletion flow.
- [x] Prevent accidental deletion if live auth ownership is ambiguous.
- [x] Soft-delete corresponding `profiles` DB row.
- [x] Refresh UI.
- [x] Add tests.
  - Verification: `npm run check`
  - Result: PASS — delete confirms the named profile, preserves usage rows through soft delete, handles signed-in/current ownership safely, and refreshes the tree.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`

---

## Milestone 5 — Accounts TreeView and fast-switch UI

### Extension manifest

- [x] Add CMA Activity Bar container.
- [x] Add Accounts view.
- [x] Add account commands.
- [x] Add view-title menus.
- [x] Add item context menus.
- [x] Add command palette entries.

### TreeDataProvider

- [x] Create `AccountsTreeDataProvider`.
- [x] List profiles sorted consistently.
- [x] Show account name.
- [x] Show email/address when available.
- [x] Show selected marker.
- [x] Show signed-in marker.
- [x] Show mismatch warning.
- [x] Add tooltip with non-secret metadata.
- [x] Assign context values:
  - [x] `cma.account.signedOut`
  - [x] `cma.account.signedIn`
  - [x] `cma.account.current.signedOut`
  - [x] `cma.account.current.signedIn`
  - [x] `cma.account.current.mismatch`
- [x] Refresh on profile changes.
- [x] Refresh on auth changes.
- [x] Refresh on state changes.
  - Verification: `npm run check`
  - Result: PASS — the provider watches account directories, live auth, and CMA state and disposes watchers on shutdown.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`

### Right-click actions

- [x] Signed out -> Sign In.
- [x] Signed in -> Sign Out.
- [x] Signed in + not current -> Select Account.
- [x] Current -> hide Select Account.
- [x] Always allow Rename unless a transaction is active.
- [x] Delete visible with appropriate guards.
- [ ] Verify `when` clauses in VS Code tests.

### View-title buttons

- [x] Add Account button.
- [x] Show Usage button.
- [x] Refresh button.

### Status bar fast switch

- [x] Create status bar item.
- [x] Show current profile name.
- [x] Show warning if unmanaged/mismatch.
- [x] Click opens account Quick Pick.
- [x] List only signed-in profiles as selectable.
- [x] Include Add Account action.
- [x] Selecting current account is a no-op.
  - Verification: `npm run check`
  - Result: PASS — status-bar Quick Pick includes Add Account; selecting the current profile returns an unchanged switch result.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`
- [x] Selecting other account invokes same transactional switch service.

---

## Milestone 6 — SQLite usage storage

### Dependency/build

- [x] Add `better-sqlite3` or chosen SQLite implementation.
- [x] Verify extension-host compatibility.
- [x] Verify VSIX packaging.
- [x] Plan target-specific native builds if using native module.
  - Result: not required for v0.1.0; the extension uses the VS Code host's built-in `node:sqlite` path and has no packaged native SQLite dependency.
- [x] Add DB health check.
  - Verification: `npm run check`
  - Result: PASS — SQLite reports schema/integrity health, safely closes/reopens, and leaves failed initialization retryable.
  - Implementation commit: `4fe045bee171f9ef0a7c430107052b91f584a222`

### Database initialization

- [x] Create `src/usage/database.ts`.
- [x] Create DB at `~/.codex/cma/usage.sqlite`.
- [x] Enable foreign keys.
- [x] Enable WAL mode.
- [x] Set busy timeout.
- [x] Add migration runner.
- [x] Add `schema_migrations`.

### Tables

- [x] Migration 001: `profiles`.
- [x] Migration 002: `account_switches`.
- [x] Migration 003: `usage_events`.
- [x] Migration 004: `usage_cursors`.
- [x] Add indexes.
- [x] Add `UNIQUE(source_fingerprint)` dedup constraint.
- [x] Add migration tests.

### Profile synchronization to DB

- [x] On profile create -> insert.
- [x] On profile rename -> update name/slug.
- [x] On identity discovery -> update address/IDs.
- [x] On profile delete -> set `deleted_at`.
- [x] Preserve usage joins after profile directory deletion.
  - Verification: `npm run check`
  - Result: PASS — profile lifecycle callbacks upsert metadata and soft-delete DB rows without removing usage history.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`

### Switch intervals

- [x] Create `UsageAttributionService`.
- [x] On activation, ensure current selected account has an open interval.
- [x] On switch:
  - [x] close previous interval;
  - [x] open target interval.
- [x] On sign out:
  - [x] close interval;
  - [ ] optionally open unattributed interval.
- [x] Make interval update transactional.
- [x] Test timestamp boundary behavior.
  - Verification: `npm run check`
  - Result: PASS — sign-out closes the active profile interval; boundary test verifies the exact closing timestamp.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`

---

## Milestone 7 — Rollout watcher and token parser

### Watcher

- [x] Create `src/usage/rolloutWatcher.ts`.
- [x] Watch `~/.codex/sessions`.
- [ ] Watch `~/.codex/archived_sessions` if desired.
- [x] Detect newly created rollout files.
- [x] Detect appends.
- [ ] Detect rename/archive.
- [x] Add periodic metadata reconciliation.
- [x] Deduplicate watcher notifications.
- [x] Stop watchers on extension deactivation.

### Cursor/tailer

- [x] Create `src/usage/rolloutTailer.ts`.
- [x] Load cursor by rollout path.
- [x] Track byte offset.
- [x] Handle file identity/inode when available.
- [x] Handle truncate/reset.
- [x] Handle partial final line.
- [x] Never read entire existing rollout during normal operation.
- [x] Default new-install baseline to EOF for already-existing files.
- [x] For newly created files, follow from beginning but baseline first cumulative snapshot as designed.
- [x] Persist cursor after successful batch.
- [x] Make cursor update transactional with usage inserts where practical.

### Large-line protection

- [x] Do bounded prefix inspection before full `JSON.parse`.
- [x] Parse only candidate `event_msg/token_count` lines.
- [x] Do not JSON.parse giant function output lines.
- [x] Add configurable safety cap for candidate token lines.
- [x] Log only line size/path metadata on parse failure.
- [x] Never log line contents.
- [x] Add a synthetic 50+ MB non-token fixture generator test without committing giant fixture files.
  - Verification: `npm run check`
  - Result: PASS — the test generates a 50 MiB line at runtime and confirms bounded skipping without a giant fixture.
  - Implementation commit: `4fe045bee171f9ef0a7c430107052b91f584a222`

### Token parser

- [x] Create `src/usage/tokenCountParser.ts`.
- [x] Parse top-level timestamp.
- [x] Parse optional ordinal.
- [x] Require `type == event_msg`.
- [x] Require `payload.type == token_count`.
- [x] Parse `info.total_token_usage`.
- [x] Parse `info.last_token_usage`.
- [x] Parse:
  - [x] input tokens
  - [x] cached input tokens
  - [x] output tokens
- [x] Ignore unknown fields.
- [x] Tolerate missing cached-input field as zero/unknown according to parser policy.
- [x] Use `bigint`.
- [x] Reject negative values.
- [x] Add fixture tests.

### Cumulative-delta algorithm

- [x] First observation establishes baseline in default no-backfill mode.
- [x] Increased cumulative totals -> calculate component deltas.
- [x] Unchanged cumulative totals -> no usage row.
- [x] Repeated `last_token_usage` + unchanged cumulative -> no usage row.
- [x] Detect cumulative reset/epoch.
- [x] Define reset criteria.
- [x] On confirmed reset, count `last_token_usage` once.
- [x] On ambiguous reset, do not guess; emit diagnostic.
- [x] Persist epoch to cursor.
- [x] Add regression tests for duplicate-rate-limit token events.

### Source fingerprint

- [x] Build deterministic source fingerprint from:
  - [x] rollout identity/path
  - [x] ordinal if available
  - [x] timestamp
  - [x] cumulative values
  - [x] epoch
- [x] Hash it.
- [x] Enforce DB unique constraint.
- [x] Verify repeated watcher events cannot duplicate usage.

### Attribution

- [x] Look up account interval for event timestamp.
- [x] Store stable profile ID.
- [x] Store account address/email snapshot if available.
- [x] Support switching accounts in same rollout file.
- [x] Define `unknown`/`unattributed` behavior.
- [x] Never silently attribute uncertain old events.
- [x] Add integration test:
  - [x] A active;
  - [x] token event;
  - [x] switch B;
  - [x] token event in same file;
  - [x] totals split correctly.
  - Verification: `npm run check`
  - Result: PASS — one shared rollout is split between A and B, and usage rows plus the cursor commit in one SQLite transaction.
  - Implementation commit: `011d5ea`

---

## Milestone 8 — Show Usage webview

### Queries

- [x] Create `src/usage/usageRepository.ts`.
- [x] Aggregate all-time totals.
- [x] Aggregate by profile.
- [x] Aggregate by account address.
- [x] Aggregate Today.
- [x] Aggregate last 7 days.
- [x] Aggregate last 30 days.
- [x] Query paginated interactions.
- [x] Use SQL aggregation, not in-memory full-table aggregation.
- [x] Add query tests.

### Webview

- [x] Create `src/ui/usagePanel.ts`.
- [x] Create webview panel.
- [x] Add strict CSP.
- [x] Use nonce.
- [x] No remote JavaScript.
- [x] No auth data.
- [x] Escape profile names/address fields.
- [x] Implement extension-host message handler.
- [x] Implement webview request/response messages.

### Counters

- [x] Input Tokens card.
- [x] Cached Input Tokens card.
- [x] Output Tokens card.
- [x] Number formatting.
- [x] Loading state.
- [x] Empty state.
- [x] Error/degraded state.

### Filters

- [x] Current account.
- [x] Specific account.
- [x] All accounts.
- [x] Today.
- [x] 7 days.
- [x] 30 days.
- [x] All time.
- [x] Refresh button.

### Interaction list

- [x] Timestamp.
- [x] Account.
- [x] Input.
- [x] Cached Input.
- [x] Output.
- [x] Pagination.
- [x] Do not expose rollout conversation content.

  - Verification: `npm test`; `npm run package`.
  - Result: PASS — parser/tailer, SQLite deduplication, SQL totals, filtered/paginated usage UI, CSP webview, and VSIX checks pass. Live VS Code integration is blocked by DNS access.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`

### Disclaimer

- [x] Add:
  ```text
  Local token counters are derived from Codex rollout events and may not equal
  ChatGPT subscription quota, billing, or server-side rate-limit accounting.
  ```

---

## Milestone 9 — Diagnostics and recovery

### Output channel

- [x] Create `Codex Account Manager` output channel.
- [x] Add structured log levels.
- [x] Central secret-redaction function.
- [x] Add tests proving fake token strings are redacted.
- [x] Never log auth JSON.
- [x] Never log rollout message contents.
  - Verification: `npm run check`; `npm run scan:secrets`
  - Result: PASS — structured logger redacts credential keys, auth JSON, rollout payloads, tokens, and bearer values.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`

### Diagnostics command

- [x] CMA version.
- [x] VS Code version.
- [x] OS/platform.
- [x] Resolved Codex home.
- [x] CMA home.
- [x] config exists.
- [x] credential storage mode.
- [x] live auth exists.
- [x] live auth valid boolean.
- [x] selected profile.
- [x] live/profile match boolean.
- [x] SQLite health.
- [x] SQLite schema version.
- [x] watcher health.
- [x] count of parser failures.
- [x] switch lock state.
- [x] current Codex version if discoverable.
  - [x] Add Copy Diagnostics with redaction.
  - Verification: `npm run check`
  - Result: PASS — diagnostics collect safe version, auth/config, profile match, SQLite, watcher/parser, lock, and Codex-version fields without credential contents.
  - Implementation commit: `47a41bb88d5a3ef4169f9c099200ec2b25a47f86`

### Recovery commands

- [x] Import Current Codex Account.
- [x] Repair Selected Profile State.
- [x] Clear Stale Switch Lock.
- [x] Rebuild Usage Database.
- [x] Backup Usage Database.
- [x] Re-scan Usage From Now.
- [x] Re-authenticate Broken Profile.
  - Verification: `npm run check`
  - Result: PASS — recovery commands are contributed and wired to non-secret import/repair, explicit rebuild/backup/rescan, and profile re-authentication flows.
  - Implementation commit: `4fdf0043cfae359bb14af11c20556dbd76173703`

### DB corruption behavior

- [x] Account switching works even if usage DB fails.
- [x] Usage collector disables itself safely.
- [x] Show warning without blocking Codex.
- [x] Offer DB backup/rebuild.
  - Verification: `npm run check`
  - Result: PASS — a failed usage database disables collection, reports a non-secret warning, and leaves account switching non-blocking.
  - Implementation commit: `068a674`

---

## Milestone 10 — Security hardening

- [x] Audit every log statement for secret leakage.
- [x] Audit every webview message type.
- [x] Audit SQLite schema for accidental auth storage.
- [x] Verify profile directory permissions.
- [x] Verify auth file permissions.
- [x] Verify temp login directory cleanup.
- [x] Verify rollback temp cleanup.
- [x] Verify profile-name path traversal protection.
- [x] Verify child processes use argument arrays.
- [x] Verify no profile data is inserted into shell command strings.
- [ ] Add dependency audit.
- [ ] Add license audit.
- [x] Add secret scanner.
- [x] Add malicious/malformed profile metadata tests.
- [x] Add symlink attack/path replacement tests where practical.
- [x] Decide symlink policy for profile directories and live auth.
  - Result: refuse unexpected symlinks on secret mutation paths; do not follow or replace them.
  - Implementation commit: `011d5ea`
- [x] Prefer refusing unexpected symlinks for secret mutation paths.
- [x] Document local threat model.

  - Verification: `npm run check`; `npm run scan:secrets`; `npm run package`.
  - Result: PASS for implemented local checks. Cross-platform, live VS Code, and crash/concurrency acceptance tests remain unchecked.
  - Implementation commit: `91adb89a1894a6e639b8c6be1deb61fac97cbf7c`

---

## Milestone 11 — Concurrency and crash hardening

### Multiple VS Code windows

- [ ] Start two Extension Development Host windows on same fake home.
- [ ] Trigger simultaneous A -> B and A -> C switch.
- [ ] Verify one lock winner.
- [ ] Verify no corrupt live auth.
- [ ] Verify loser reports retryable conflict.
- [ ] Verify SQLite switch intervals remain valid.

### Crash scenarios

- [ ] Crash after backup but before live replace.
- [ ] Crash after live replace but before state update.
- [ ] Crash after state update but before profile sync.
- [x] Recovery detects state/live mismatch.
- [x] Recovery never overwrites unknown auth.
  - Verification: `npm run check`
  - Result: PASS — reconciliation reports known-profile/unmanaged mismatch and import/repair never mutates unknown live auth.
  - Implementation commit: `3e6de78`
- [ ] Add startup transaction cleanup for stale `.cma-next`/rollback files.
- [ ] Record enough non-secret transaction metadata to recover safely if needed.

### Auth refresh race

- [ ] Simulate Codex rewriting `auth.json` during switch.
- [ ] Detect pre/post fingerprint change.
- [ ] Abort or safely reconcile.
- [ ] Never discard a newer live credential state.

---

## Milestone 12 — Performance hardening

- [x] Test with 1,000+ rollout files.
- [ ] Test with multi-GB aggregate sessions directory metadata.
- [ ] Ensure startup does not read every rollout fully.
- [x] Ensure existing-file baseline uses metadata/EOF efficiently.
- [x] Test rapidly appended token events.
- [x] Batch SQLite writes.
- [ ] Benchmark usage query.
- [x] Paginate webview rows.
- [ ] Ensure watcher reconciliation does not spike CPU.
- [x] Ensure large non-token lines are skipped without JSON parsing.
  - Verification: `npm run check`
  - Result: PASS — 1,001 rollout discovery, sparse EOF, 1,024 appended events, 50 MiB non-token-line, batched SQLite insert/cursor, and paginated webview regression checks pass.
  - Implementation commits: `4fe045bee171f9ef0a7c430107052b91f584a222`, `011d5ea`, `2d77f3a`
- [ ] Monitor extension-host memory during long Codex session.

---

## Milestone 13 — Remote/WSL/platform testing

### macOS

- [ ] Intel if supported.
- [ ] Apple Silicon.
- [ ] File permissions.
- [ ] Login flow.
- [ ] SQLite native module packaging.

### Windows

- [ ] x64.
- [ ] Reserved profile-name handling.
- [ ] Atomic replace behavior.
- [ ] File lock behavior.
- [ ] Native SQLite packaging.

### Linux

- [ ] x64.
- [ ] permissions.
- [ ] login flow.
- [ ] native SQLite packaging.

### WSL / Remote SSH

- [ ] Verify CMA runs where remote `~/.codex` exists.
- [ ] Verify native Codex extension and CMA see same Codex home.
- [ ] Verify status/diagnostics identify remote path.
- [ ] Verify login browser/device flow.
- [x] Document required extension installation side.

---

## Milestone 14 — End-to-end acceptance tests

### Account lifecycle

- [ ] Add `Work`.
- [ ] Sign in Work.
- [ ] Add `Personal`.
- [ ] Sign in Personal.
- [ ] Select Work.
- [ ] reload.
- [ ] Native Codex works as Work.
- [ ] Select Personal.
- [ ] reload.
- [ ] Native Codex works as Personal.
- [ ] No repeated browser auth is required during normal switching.
- [ ] Rename Personal -> Home.
- [ ] Usage history remains attached.
- [ ] Sign out Home.
- [ ] Sign In appears.
- [ ] Delete Home.
- [ ] Work remains intact.

### Config/MCP preservation

- [ ] Take hash/backup of shared config.
- [ ] Switch accounts 20 times.
- [ ] Confirm no account-specific config copy was introduced.
- [ ] Confirm MCP definitions remain unchanged.
- [ ] Confirm MCPs still appear/work in native Codex.

### Auth refresh

- [ ] Simulate or observe active auth refresh.
- [ ] Verify stored selected profile gets refreshed copy.
- [ ] Switch away.
- [ ] Switch back.
- [ ] Verify no re-authentication caused by restoring stale profile data.

### Conversation continuity

- [ ] Start native Codex conversation as Account A.
- [ ] Produce token usage.
- [ ] Switch to Account B.
- [ ] reload/reopen same local conversation.
- [ ] Continue it.
- [ ] Verify later usage is attributed to B.
- [ ] Verify local conversation files were not rewritten by CMA.

### Usage

- [ ] New interaction produces usage row.
- [ ] Input count increments.
- [ ] Cached input count increments.
- [ ] Output count increments.
- [ ] Timestamp is correct.
- [ ] Account address/profile is correct.
- [ ] Duplicate token event does not increment.
- [ ] Same rollout can contain A-attributed then B-attributed usage.
- [ ] Show Usage totals equal SQL query totals.

---

## Milestone 15 — Documentation and release

### README

- [x] Explain what CMA does.
- [x] Explain what CMA does not do.
- [x] Explain dependency on native Codex extension.
- [x] Explain file-backed auth requirement.
- [x] Explain storage paths.
- [x] Explain security of `auth.json`.
- [x] Explain account switch/reload behavior.
- [x] Explain usage-counter limitations.
- [x] Explain remote/WSL behavior.
- [x] Add troubleshooting.
- [x] Add uninstall behavior.

### Privacy/security docs

- [x] State all data is local unless user explicitly uses Codex login.
- [x] State CMA only sends access tokens to the hard-coded quota endpoint; quota requests are disabled by default and can be enabled for the selected or all signed-in profiles by configuration.
- [x] State usage DB contains account metadata/token counts/timestamps.
- [x] State rollout conversation content is not stored in CMA DB.
- [x] State webview receives aggregate usage and token-only interaction rows.
  - Verification: README.md; PRIVACY.md
  - Result: PASS — local storage, token handling, SQLite contents, webview boundaries, troubleshooting, remote/WSL behavior, and uninstall behavior are documented.
  - Implementation commit: `011d5ea`

### Release packaging

- [x] Build production bundle.
- [x] Verify no source maps contain secrets.

### Public release gate

- [x] Make quota network access opt-in and document the token data flow.
  - Verification: `npm run check`; `npm run scan:secrets`; `npm run package`
  - Result: PASS — quota requests default to `disabled`; Settings exposes `selected` and `all` opt-in scopes; 17 tests passed; secret scan and VSIX packaging passed.
  - Implementation commit: `7f229c7cff7b3edab08f2333a4e44b51b5e5333c`
- [x] Reject non-exact login hosts before opening browser links.
  - Verification: `./node_modules/.bin/tsc --outDir .test-out`; `node --test .test-out/test/services.test.js`
  - Result: PASS — valid HTTPS hosts are accepted; HTTP, user-info, suffix-host, and malformed candidates are rejected.
  - Implementation commit: `7c0b7cebfeabf2621a39a59b47482e8c52ea7bad`
- [x] Prevent unverified JWT claims from authorizing account ownership.
  - Verification: `npm run compile`; focused auth, reconciliation, sign-out, profile, and security tests (5 files)
  - Result: PASS — JWT claims remain available for display, while sync, reconciliation, sign-out, and quota account headers use structured identity only.
  - Implementation commit: `82fb6cf99f65f39e8b8dccf848578a03cb052994`
- [x] Exclude development files from the published VSIX.
  - Verification: `npm run package`; `unzip -Z1 codex-account-manager-0.1.0.vsix`
  - Result: PASS — VSIX contains only the manifest, release documents, assets, and `dist/extension.js`; development tooling, docs, scripts, tests, source, and maps are excluded.
  - Implementation commit: `731ad558975795fda0912e8134e1a6f99b1b1744`
- [ ] Run the native VS Code integration smoke test.
  - Blocked: `npm run test:integration` cannot resolve `update.code.visualstudio.com` in this environment.
- [ ] Package target-specific VSIX files if necessary.
- [ ] Install VSIX into clean profile.
- [ ] Run smoke test.
- [ ] Publish v0.1.0.
- [ ] Tag release.
- [x] Create changelog entry.
  - Implementation commit: `1be466e`

---

# Post-MVP Backlog

## Faster native Codex reload

- [ ] Investigate whether OpenAI exposes a supported cross-extension auth reload command/API.
- [ ] Add adapter only if stable and public enough.
- [ ] Keep full-window reload fallback.

## Historical usage import

- [ ] Add explicit backfill command.
- [ ] Preview count/date range first.
- [ ] Ask how to attribute pre-CMA events.
- [x] Never guess profile attribution silently.
- [x] Make import idempotent.

  - Verification: `npm test`; `npm run package`.
  - Result: PASS — startup sync repairs selected signed-in profiles, usage profiles are upserted before switch intervals, existing `~/.codex/sessions` rollout files are imported with unattributed historical events, and the webview supports 7/30/90/365-day plus all-time filters.
  - Implementation commit: `b6a242f670e53581c8baf5f6e35124cd3125b7be`

## Usage analytics

- [ ] Daily chart.
- [ ] Weekly chart.
- [ ] Per-model totals when available.
- [ ] Per-project totals when safely derivable.
- [ ] Export CSV.
- [ ] Export JSON.
- [ ] Clear usage history by account/date.

## Profile UX

- [ ] Reorder profiles.
- [ ] Favorite profiles.
- [ ] keyboard shortcut for account Quick Pick.
- [ ] Optional color/icon per profile.
- [ ] Duplicate-name UI with unique slugs.
- [ ] "Last used" timestamp.

## Backup/import

- [ ] Export profile metadata without auth.
- [ ] Explicit encrypted auth backup if ever implemented.
- [ ] Never export raw auth by default.
- [ ] Import profile directory with security validation.

---

# v0.1 Release Gate

Do not release until every item below passes:

- [x] Profile auth is never written to logs.
- [x] Profile auth is never written to SQLite.
- [x] Profile auth is never sent to a webview.
- [x] Active auth refresh is preserved before switching away.
- [x] Switching is atomic and rollback-tested.
- [ ] Multi-window switch lock works.
- [ ] Native Codex uses selected account after documented reload.
- [x] Shared `~/.codex/config.toml` is preserved.
- [x] MCP configuration is preserved.
- [x] Usage tracker does not blindly sum repeated `last_token_usage`.
- [x] Usage attribution works across an account switch in the same rollout.
- [ ] Existing large rollout history does not cause full startup scan.
- [x] Usage DB failure does not prevent account switching.
- [ ] macOS/Windows/Linux target(s) claimed by the release have been tested.
- [x] README clearly labels token totals as local observed usage, not billing/quota truth.
