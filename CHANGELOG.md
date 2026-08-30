# Changelog

## [0.1.4] - 2026-08-29

### Features

- Added estimated USD cost reporting for known models, with configurable model pricing overrides.
- Added cost totals and sorting to the Usage dashboard.
- Updated quota details to show five-hour and weekly windows.

### Other

- Bumped the extension version to 0.1.4.

## [0.1.2] - 2026-08-28

### Features

- Added automatic and manual keep-alive checks that pre-start each signed-in profile's rolling 5-hour refresh window, so its quota is closer to resetting when the account is switched to.
- Added daily and weekly quota-window details, reset times, and last keep-alive timestamps to the Usage view.

### Other

- Enabled startup activation and documented keep-alive credential, network, and quota-consumption behavior.

## 0.1.0

- Added local Codex account profiles with staged sign-in, atomic switching, sign-out, repair, and recovery commands.
- Added local rollout token usage history with account attribution, 30-day filtering, quotas, pagination, and SQLite recovery.
- Added redacted diagnostics, security checks, and privacy documentation.
