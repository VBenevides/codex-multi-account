# CMA v0 Review TODO

This checklist follows the code audit in `internal/v0-review/REPORT.md`.

## Public release gate

- [x] [High] Parse login URLs with `URL` and require exact HTTPS hosts.
  - Verification: `./node_modules/.bin/tsc --outDir .test-out`; `node --test .test-out/test/services.test.js`
  - Result: PASS — valid origins pass; HTTP, user-info, suffix-host, and malformed candidates fail.
  - Implementation commit: `7c0b7cebfeabf2621a39a59b47482e8c52ea7bad`
- [x] [High] Make quota token uploads disabled by default.
- [x] [High] Correct `PRIVACY.md` to describe quota token uploads.
- [x] [Medium] Stop using unsigned JWT claims as the sole auth ownership proof.
  - Verification: `npm run compile`; focused auth, reconciliation, sign-out, profile, and security tests (5 files)
  - Result: PASS — JWT claims remain display metadata; structured identity controls ownership.
  - Implementation commit: `82fb6cf99f65f39e8b8dccf848578a03cb052994`
- [ ] [Medium] Run native VS Code integration smoke tests on supported hosts.
  - Blocked: `npm run test:integration` cannot resolve `update.code.visualstudio.com` in this environment.
- [x] [Low] Exclude development files from the published VSIX.
  - Verification: `npm run package`; `unzip -Z1 codex-account-manager-0.1.0.vsix`
  - Result: PASS — only release files and the runtime bundle remain.
  - Implementation commit: `731ad558975795fda0912e8134e1a6f99b1b1744`

## 1. Security

- [x] [High] Restrict quota token requests.
  - [x] Add an explicit quota-network setting.
  - [x] Default remote quota checks to disabled.
  - [x] Show a privacy notice before the first request.
  - [x] Update `README.md` and `internal/v0/TODO.md` to describe the real data flow.
- [x] [High] Enforce file-backed auth before account operations.
  - [x] Check `CodexConfigService.isFileBackedAuthReady()` before sign-in, switch, and sign-out.
  - [x] Show the existing enable command when the check fails.
  - [x] Add tests for `file`, `keyring`, `auto`, and missing config modes.
- [x] [High] Fail closed when secret file permissions cannot be applied.
  - [x] Separate unsupported filesystems from permission failures.
  - [x] Verify restrictive permissions where the platform supports them.
  - [x] Stop before credential rename when restrictive permissions are unsupported.
- [x] [High] Reject unknown identity matches during live-auth synchronization.
  - [x] Require at least one equal identity field before copying refreshed auth.
  - [x] Reuse one identity matcher across sync and sign-out paths.
  - [x] Add an unknown-to-unknown replacement regression test.
- [x] [Medium] Remove abandoned login staging credentials.
  - [x] Clean old staging directories during activation.
  - [x] Protect the active staging directory from cleanup.
  - [x] Add crash and cleanup tests.
- [x] [Medium] Reject symlinks on every profile auth read and copy path.
  - [x] Add a shared regular-file check.
  - [x] Apply it to auth reads, copies, and deletion checks.
  - [x] Add symlink regression tests.

  Verification: `npm run check`; focused security/login tests. Implementation commits: `eb3db36`, `b0b8369`, `b00b5b1`, `f18164b`.

## 2. Bugs

- [x] [High] Restore account attribution before historical usage import.
  - [x] Read persisted `account_switches` intervals at startup.
  - [x] Attribute rollout timestamps through those intervals.
  - [x] Keep uncertain rows under `Unknown` or `Unattributed`.
  - [x] Add restart and historical attribution tests.
- [x] [Medium] Persist the rollout cursor model.
  - [x] Read `model` in `UsageRepository.readCursor()`.
  - [x] Write and update `model` in `UsageRepository.writeCursor()`.
  - [x] Add a restart regression test.
- [x] [Medium] Make SQLite backups WAL-safe.
  - [x] Use SQLite `VACUUM INTO` backup support.
  - [x] Test backup contents while WAL contains pending data.
- [x] [Medium] Report usage service failures after database open.
  - [x] Report scan, parser, watcher, and insert failures without raw data.
  - [x] Expose service health through diagnostics.
  - [x] Add a status-bar warning for degraded collection.
- [x] [Medium] Remove the stale-lock race window.
  - [x] Use an atomic lock-directory and quarantine protocol.
  - [x] Add a concurrent lock-claim race test.
- [x] [Low] Serialize profile deletion with switching.
  - [x] Hold the switch lock across sign-out and deletion.
  - [x] Re-read state before removing the profile directory.

  Verification: `npm run check`; usage persistence, attribution, health, and lock tests. Implementation commits: `c3531cc`, `e8ba91f`, `921e5a5`.

## 3. New Features

- [x] [High] Add a historical attribution assistant.
  - [x] Preview affected date ranges and event counts.
  - [x] Let the user map ranges to profiles.
  - [x] Never guess attribution without confirmation.
- [x] [Medium] Export filtered usage.
  - [x] Add CSV export for grouped rows and daily data.
  - [x] Add JSON export for machine use.
  - [x] Exclude credentials and conversation content.
- [x] [Medium] Add an account health view.
  - [x] Show file-backed auth readiness.
  - [x] Show live-auth ownership and mismatch state.
  - [x] Show usage database and watcher health.
  - [x] Link to safe recovery commands.
- [x] [Medium] Add safe profile backup and import.
  - [x] Export metadata without auth.
  - [x] Validate imported paths and profile schemas.
  - [x] Keep encrypted auth backup out of v0; credentials remain sign-in-only.
- [x] [Medium] Add configurable working-directory privacy.
  - [x] Support full paths, home-relative paths, and project basenames.
  - [x] Preserve exact stored values for filtering.

  Verification: `npm run check`; export, transfer, privacy, and attribution-assistant tests. Implementation commits: `db90f5f`, `921e5a5`.

## 4. Enhancements

- [x] [High] Add auth transaction fault-injection tests.
  - [x] Cover credential mutation rollback and reload failure paths.
  - [x] Assert auth and state rollback.
  - [x] Test sign-out rollback as well as switch rollback.
- [ ] [Medium] Run native VS Code integration smoke tests.
  - [ ] Test on each claimed operating system.
  - [ ] Verify Codex reload and account selection.
  - [ ] Verify shared config, MCPs, sessions, and usage attribution.
- [x] [Low] Surface parser diagnostics.
  - [x] Count skipped rollout lines.
  - [x] Show counts in diagnostics.
  - [x] Keep rollout content private.
- [x] [Low] Add login cancellation and timeout handling.
  - [x] Add a user-visible cancel action.
  - [x] Add a bounded process timeout.
  - [x] Clean staging data on cancel and timeout.

  Verification: `npm run check`; `npm run build`; `npm run scan:secrets`. Implementation commits: `f18164b`, `921e5a5`.

  Native VS Code integration remains pending: `npm run test:integration` is blocked in this environment by DNS resolution for `update.code.visualstudio.com`.
