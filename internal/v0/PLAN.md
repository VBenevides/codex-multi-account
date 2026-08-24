# PLAN.md — Codex Account Manager (CMA) VS Code Extension

## 1. Purpose

Build a VS Code extension named **Codex Account Manager (CMA)** that works alongside the native OpenAI Codex VS Code extension.

CMA does **not** implement a chat UI and does **not** replace Codex. Its responsibilities are:

1. Manage multiple locally stored Codex authentication profiles.
2. Switch which profile is exposed to Codex as `~/.codex/auth.json`.
3. Keep the user's existing `~/.codex/config.toml`, MCP configuration, sessions, skills, and other Codex state shared.
4. Track locally observable token usage from Codex session rollout events.
5. Display per-account token totals in a CMA usage page.

The native Codex extension remains responsible for:
- chat/conversation UI;
- model execution;
- MCP execution;
- session management;
- approvals;
- authentication token refresh while an account is active.

---

## 2. User Requirements

### Account storage

Profiles must be stored under:

```text
~/.codex/cma/accounts/<profile-name>/
```

The live authentication file consumed by Codex remains:

```text
~/.codex/auth.json
```

The shared Codex configuration remains:

```text
~/.codex/config.toml
```

All accounts therefore share the same:
- `config.toml`;
- MCP definitions;
- Codex sessions/history;
- skills;
- other state under the normal Codex home.

### Account management

CMA must allow:
- Create account/profile.
- Edit account name.
- Delete account/profile.
- Sign In when the profile is signed out.
- Sign Out when the profile is signed in.
- Select Account when it is not currently selected.

### Account UI

The CMA sidebar displays profiles and their states.

Right-click actions:

| State | Sign In | Sign Out | Select Account | Edit | Delete |
|---|---:|---:|---:|---:|---:|
| Signed out, not selected | Yes | No | No | Yes | Yes |
| Signed in, not selected | No | Yes | Yes | Yes | Yes |
| Signed in, selected | No | Yes | No | Yes | Yes |
| Signed out, selected | Yes | No | No | Yes | Conditional |

The selected profile should have a clear icon/description such as:

```text
✓ Work
  user@example.com
```

### Usage page

A **Show Usage** action opens a VS Code webview containing at minimum:

- Input Tokens
- Cached Input Tokens
- Output Tokens

Persistent usage data must live in:

```text
~/.codex/cma/usage.sqlite
```

Each usage record must be attributable to an account and timestamp.

---

## 3. Current Codex Constraints the Design Must Respect

### 3.1 Codex authentication is a shared cache

Codex CLI and the Codex IDE extension share cached authentication. File-backed authentication is stored at:

```text
$CODEX_HOME/auth.json
```

with the default `CODEX_HOME` being:

```text
~/.codex
```

CMA relies on that behavior.

### 3.2 CMA requires file-backed credential storage

Codex can use:
- `file`;
- `keyring`;
- `auto`.

CMA's profile-switching design requires the live credentials to exist as `~/.codex/auth.json`.

Therefore CMA must verify that:

```toml
cli_auth_credentials_store = "file"
```

is effective for Codex.

Preferred behavior:
1. On activation, inspect `~/.codex/config.toml`.
2. If file-backed auth is not configured, show an onboarding warning.
3. Offer an explicit **Enable File-backed Auth for CMA** action.
4. Only modify `config.toml` after user confirmation.
5. Preserve all unrelated TOML content and comments when modifying it.
6. Never overwrite/recreate the entire config just to change this setting.

If the user declines, account switching should be disabled with a clear diagnostic.

### 3.3 `auth.json` is a secret

Treat every profile's `auth.json` as password-equivalent material.

Rules:
- Never log its contents.
- Never put it into SQLite.
- Never send it to a webview.
- Never put it in extension telemetry.
- Never show access/refresh tokens in errors.
- Use restrictive filesystem permissions where supported.
- Use atomic writes/renames for profile switching.

### 3.4 Codex refreshes active credentials

Codex can refresh ChatGPT-managed credentials and rewrite the live `auth.json`.

This creates an important requirement:

> The currently selected profile's stored authentication must be synchronized from the live `~/.codex/auth.json` before switching away, and while it changes.

Otherwise CMA could later restore a stale token bundle.

### 3.5 Do not duplicate one refresh-token state into concurrently active homes

A profile has one authoritative credential state.

CMA should:
- keep only one live account at `~/.codex/auth.json`;
- serialize account switches;
- sync refreshed credentials back to that profile;
- avoid creating multiple simultaneously used copies of the same profile auth.

### 3.6 Switching credentials does not guarantee the already-running Codex process reloads them

Replacing `~/.codex/auth.json` changes the persistent auth state, but another extension may already have authentication loaded in memory.

CMA must therefore have an explicit **Codex reload strategy**.

Safe v1 strategy:
1. Perform the atomic credential swap.
2. Update CMA state.
3. prompt/trigger a VS Code window reload.
4. After reload, native Codex starts against the new `~/.codex/auth.json`.

Do not kill arbitrary Codex processes.

Do not depend on undocumented internal OpenAI extension commands as the only switching mechanism.

An optional future adapter may detect a stable/public Codex command or API and use it, with VS Code reload as fallback.

---

## 4. Proposed Filesystem Layout

```text
~/.codex/
├── auth.json                         # LIVE auth used by native Codex
├── config.toml                       # SHARED Codex config + MCPs
├── sessions/                         # SHARED Codex conversations/rollouts
├── archived_sessions/
├── skills/
├── ...
└── cma/
    ├── accounts/
    │   ├── work/
    │   │   ├── profile.json
    │   │   └── auth.json             # secret; present only when signed in
    │   ├── personal/
    │   │   ├── profile.json
    │   │   └── auth.json
    │   └── client-a/
    │       └── profile.json          # signed out: no auth.json
    │
    ├── state.json                    # selected profile + CMA state
    ├── switch.lock                   # short-lived multi-window switch lock
    ├── usage.sqlite                  # token usage DB
    └── logs/
        └── cma.log                   # sanitized logs only
```

### `profile.json`

Use a stable UUID internally even though the directory is based on the editable name.

Example:

```json
{
  "version": 1,
  "id": "01J...stable-id",
  "name": "Work",
  "slug": "work",
  "createdAt": "2026-08-16T00:00:00.000Z",
  "updatedAt": "2026-08-16T00:00:00.000Z",
  "identity": {
    "email": "user@example.com",
    "chatgptUserId": null,
    "accountId": null
  }
}
```

`identity` is metadata only. It must never contain tokens.

### `state.json`

Example:

```json
{
  "version": 1,
  "selectedProfileId": "01J...stable-id",
  "selectedProfileSlug": "work",
  "selectedAt": "2026-08-16T00:05:00.000Z",
  "lastObservedLiveAuthFingerprint": "sha256:..."
}
```

Do not put raw auth content in `state.json`.

---

## 5. Account Identity and Auth Fingerprints

CMA needs to know whether the live `~/.codex/auth.json` corresponds to the stored selected profile.

Implement:

```ts
interface AuthIdentity {
  email?: string;
  chatgptUserId?: string;
  accountId?: string;
  authMode?: string;
}

interface AuthFingerprint {
  value: string; // SHA-256 over normalized auth bytes; never displayed by default
}
```

### Identity extraction

Prefer identity fields that Codex already stores in structured auth metadata when present.

If identity data is unavailable:
- profile management still works;
- display the user-chosen Account Name;
- show email/address as `Unknown`;
- do not block switching.

If JWT payload decoding is used as a fallback:
- decode locally only;
- treat claims as display metadata, not verified authorization facts;
- never persist the raw JWT outside the profile auth file.

### Fingerprinting

Use SHA-256 over the exact auth bytes or canonical parsed JSON.

Purpose:
- detect whether the live auth changed;
- detect profile/live mismatches;
- avoid unnecessary writes.

The hash is not a replacement for secure token storage.

---

## 6. Core Account State Model

Each profile has two independent concepts:

```ts
type SignInState = "signedIn" | "signedOut";
type SelectionState = "selected" | "notSelected";
```

Derived rules:

```text
signedIn  = profile auth.json exists and passes minimum structural validation
selected  = state.json selectedProfileId == profile.id
liveMatch = fingerprint(~/.codex/auth.json) == fingerprint(profile/auth.json)
```

A selected profile can temporarily be in a mismatch state after external edits. Surface this as a warning rather than silently destroying either file.

Recommended tree context values:

```text
cma.account.signedOut
cma.account.signedIn
cma.account.current.signedOut
cma.account.current.signedIn
cma.account.current.mismatch
```

These drive VS Code `view/item/context` menus.

---

## 7. Account Lifecycle

## 7.1 Create Account

Command:

```text
CMA: Add Account
```

Flow:
1. Prompt for Account Name.
2. Trim and validate.
3. Generate a filesystem-safe slug.
4. Reject collisions.
5. Generate stable profile UUID.
6. Create:
   ```text
   ~/.codex/cma/accounts/<slug>/profile.json
   ```
7. Do not create `auth.json` yet.
8. Refresh tree.
9. Offer **Sign In**.

Validation:
- non-empty;
- no `.` / `..`;
- no path separators;
- no Windows reserved filenames;
- reasonable max length;
- Unicode display name is allowed;
- slug normalization is deterministic.

## 7.2 Edit Account Name

Command:

```text
CMA: Rename Account
```

Flow:
1. Prompt with existing name.
2. Validate new name.
3. Generate new slug.
4. Acquire global CMA switch/profile lock.
5. Rename the profile directory atomically when possible.
6. Update `profile.json`.
7. If selected, update `state.json`.
8. Keep stable `profile.id` unchanged.
9. Usage records continue to refer to stable `profile_id`, so history survives renames.
10. Refresh tree/webview.

## 7.3 Delete Account

Command:

```text
CMA: Delete Account
```

Rules:
- Require explicit confirmation.
- State that stored authentication for this profile will be deleted.
- Usage history should **not** be deleted by default.
- Add optional separate command later: `Delete Account and Usage History`.

If deleting the selected profile:
1. Save/sync the live auth back to it first if possible.
2. Require either:
   - select another signed-in profile; or
   - sign out the current Codex session.
3. Remove live auth only if the deleted profile is confirmed to own it.
4. Reload Codex/VS Code as required.
5. Delete profile directory.

Use the stable profile ID to retain historical usage even after the profile disappears.

## 7.4 Sign In

Command:

```text
CMA: Sign In
```

Goal: authenticate a profile without replacing the currently active account until the user explicitly selects it.

Recommended staging strategy:

```text
~/.codex/cma/login-staging/<random-id>/
├── config.toml   # minimal config forcing file-backed auth
└── auth.json     # produced by `codex login`
```

Flow:
1. Ensure `codex` executable is discoverable.
2. Create private staging directory.
3. Write minimal staging config that forces file-backed credential storage.
4. Spawn:
   ```text
   CODEX_HOME=<staging-dir> codex login
   ```
   using a VS Code terminal or a child process with visible user interaction.
5. Wait for login completion.
6. Validate `<staging-dir>/auth.json`.
7. Extract non-secret identity metadata.
8. Atomically move/copy auth into:
   ```text
   ~/.codex/cma/accounts/<slug>/auth.json
   ```
9. Apply restrictive permissions.
10. Update `profile.json`.
11. Securely remove staging directory.
12. Refresh tree.
13. Do not automatically select the profile unless product behavior explicitly chooses to do so.

Alternative:
- `codex login --device-auth` can be offered as a secondary sign-in command.

Important:
- never implement OAuth yourself;
- let Codex own authentication and refresh semantics.

## 7.5 Sign Out

Command:

```text
CMA: Sign Out
```

For a non-selected profile:
1. Confirm.
2. Delete only:
   ```text
   accounts/<slug>/auth.json
   ```
3. Clear identity metadata if desired, or retain email as non-secret profile history according to a setting.
4. Refresh tree.

For the selected profile:
1. Acquire switch lock.
2. Confirm live auth ownership.
3. Remove profile auth.
4. Remove live `~/.codex/auth.json`.
5. Update `state.json` to no selected signed-in profile.
6. trigger/prompt a VS Code reload so native Codex drops in-memory auth.
7. Refresh after activation.

## 7.6 Select Account

Command:

```text
CMA: Select Account
```

Precondition:
- target profile must be signed in.

Switch transaction:

```text
A. Lock
B. Sync current live auth -> current profile
C. Validate target auth
D. Backup live auth temporarily
E. Atomically replace ~/.codex/auth.json with target auth
F. Verify resulting fingerprint
G. Update state.json
H. Append account-switch journal entry
I. Release lock
J. Reload Codex/VS Code
```

Detailed sequence:

1. Acquire `switch.lock`.
2. Read current CMA state.
3. If there is a current selected profile:
   - read live `~/.codex/auth.json`;
   - if it belongs to current profile or is an expected refreshed version, atomically persist it to current profile;
   - if ownership is ambiguous, stop and show a conflict dialog.
4. Read target profile auth.
5. Validate JSON and minimum expected auth structure.
6. Copy current live auth to an in-memory/temp rollback file.
7. Write target auth to:
   ```text
   ~/.codex/auth.json.cma-next
   ```
8. `fsync` where practical.
9. set secure permissions.
10. rename over:
    ```text
    ~/.codex/auth.json
    ```
11. Re-read and verify fingerprint.
12. Update `state.json`.
13. Insert a switch event in SQLite:
    ```text
    old_profile_id
    new_profile_id
    switched_at
    ```
14. Remove rollback temp file.
15. Release lock.
16. Reload window / tell user a reload is required.

Failure:
- rollback live `auth.json`;
- do not change selected profile state;
- show sanitized error.

---

## 8. Live Auth Synchronization

This is required because Codex may refresh `~/.codex/auth.json` while a profile is active.

Create:

```ts
class LiveAuthSyncService
```

Responsibilities:
- watch `~/.codex/auth.json`;
- debounce changes;
- compare fingerprint;
- if the selected profile still owns the live auth, copy refreshed live auth back to:
  ```text
  accounts/<selected>/auth.json
  ```
- update `lastObservedLiveAuthFingerprint`;
- never overwrite a profile if ownership is ambiguous.

### Ownership checks

Do not rely only on file timestamp.

Use available identity fields:
1. stable ChatGPT user ID when available;
2. account/user combination when available;
3. email as weaker fallback;
4. prior fingerprint lineage / selected state;
5. otherwise mark conflict.

### Startup recovery

On CMA activation:

1. Load selected profile from `state.json`.
2. Inspect live `~/.codex/auth.json`.
3. If selected profile exists and identity matches:
   - sync live file back to profile.
4. If live auth matches a different known profile:
   - repair `state.json` to that profile after confirmation or safe deterministic match.
5. If live auth matches no profile:
   - show:
     ```text
     Codex is signed in with an unmanaged account.
     [Import as Profile] [Ignore]
     ```
6. Never overwrite an unmanaged live auth automatically.

---

## 9. Multi-Window and Concurrency Safety

Multiple VS Code windows can run CMA against the same home directory.

Implement an inter-process lock:

```text
~/.codex/cma/switch.lock
```

Lock data:

```json
{
  "pid": 12345,
  "host": "hostname",
  "createdAt": "..."
}
```

Acquire with exclusive create semantics.

Protect:
- account switching;
- selected-account sign out;
- profile rename/delete;
- state writes affecting selection.

Use a stale-lock policy:
- check process existence when possible;
- use a conservative age threshold;
- offer `CMA: Clear Stale Lock` only when safe.

SQLite itself handles database write locking, but use transactions for usage writes.

---

## 10. VS Code UI Architecture

## 10.1 Activity Bar container

Contribute a container:

```text
Codex Accounts
```

Suggested icon: account/person-switch style product icon.

Views:

```text
CMA Accounts
```

Optional future view:

```text
Recent Usage
```

## 10.2 Accounts TreeView

Implement:

```ts
class AccountsTreeDataProvider
  implements vscode.TreeDataProvider<AccountTreeItem>
```

Tree item fields:
- Account Name;
- email/address if available;
- signed-in state;
- current state;
- tooltip;
- icon;
- `contextValue`.

Suggested icons:
- current: `$(check)` or `$(account)`;
- signed in: `$(pass-filled)`;
- signed out: `$(circle-slash)`;
- mismatch/error: `$(warning)`.

## 10.3 View title buttons

Add:
- `$(add)` Add Account
- `$(graph)` Show Usage
- `$(refresh)` Refresh

## 10.4 Right-click menu

Use `view/item/context`.

Commands:
- `cma.account.signIn`
- `cma.account.signOut`
- `cma.account.select`
- `cma.account.rename`
- `cma.account.delete`

Use `when` clauses based on `viewItem` context values so invalid actions do not appear.

## 10.5 Status bar

Recommended:

```text
$(account) Codex: Work
```

Click behavior:
- open Quick Pick with signed-in profiles;
- choosing a different profile runs Select Account.

This gives an even faster switch path than right click.

---

## 11. Command Surface

Register at least:

```text
cma.account.add
cma.account.signIn
cma.account.signOut
cma.account.select
cma.account.rename
cma.account.delete

cma.usage.show
cma.accounts.refresh

cma.auth.importCurrent
cma.auth.enableFileStorage
cma.auth.diagnostics

cma.lock.clearStale
```

User-visible titles:

```text
CMA: Add Account
CMA: Sign In
CMA: Sign Out
CMA: Select Account
CMA: Rename Account
CMA: Delete Account
CMA: Show Usage
CMA: Import Current Codex Account
CMA: Auth Diagnostics
```

---

## 12. Usage Tracking Design

## 12.1 Source of truth for v1

CMA does not intercept network calls from the native Codex extension.

Instead, v1 tracks locally persisted Codex rollout events under:

```text
~/.codex/sessions/**/rollout-*.jsonl
```

and optionally:

```text
~/.codex/archived_sessions/**/rollout-*.jsonl
```

Codex rollout files can contain events shaped like:

```json
{
  "timestamp": "2026-08-16T00:00:00.000Z",
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 100,
        "cached_input_tokens": 80,
        "output_tokens": 20
      },
      "last_token_usage": {
        "input_tokens": 10,
        "cached_input_tokens": 8,
        "output_tokens": 2
      }
    }
  }
}
```

The parser must be version-tolerant and allow missing fields.

## 12.2 Important accounting rule: do not blindly sum `last_token_usage`

Codex can emit token-count events where `last_token_usage` is repeated while cumulative totals do not advance.

Therefore:

> Usage is accepted only when the cumulative usage snapshot advances, or when the parser has positively detected a new cumulative epoch.

Per file/session maintain:

```ts
interface UsageCursor {
  byteOffset: number;
  partialLine: string;
  lastInputTotal: bigint;
  lastCachedInputTotal: bigint;
  lastOutputTotal: bigint;
  lastTotalTokens?: bigint;
  lastEventTimestamp?: string;
}
```

Algorithm:

```text
if first observed event after CMA starts tracking this file:
    establish baseline
    record zero usage unless explicit backfill mode is enabled

else if cumulative totals increased:
    delta = component-wise max(current - previous, 0)
    persist delta

else if cumulative totals are unchanged:
    persist nothing

else if cumulative totals decreased:
    detect possible new epoch/reset
    if reset criteria pass:
        use the new event's last_token_usage once as the first delta
        start new epoch
    else:
        mark parser diagnostic and do not guess
```

This prevents duplicate rate-limit events from inflating totals.

## 12.3 Installation behavior

Default v1 behavior:

> Track usage from the moment CMA is installed/enabled.

Do not automatically backfill old sessions because old token events cannot always be reliably mapped to one of the user's new CMA profiles.

Optional later feature:

```text
CMA: Backfill Historical Usage
```

with explicit attribution rules and warnings.

## 12.4 Account attribution

CMA must support a user switching accounts while continuing the same local Codex conversation.

Therefore usage cannot be assigned permanently based on the session file alone.

Use a time-based account selection journal:

```text
account_switches
- profile_id
- account_address
- active_from
- active_until
```

Every token-count event has a rollout timestamp.

Attribute each accepted token delta to the profile that was active at that event timestamp.

This supports:

```text
same rollout file
  10:00 Account A -> usage A
  10:30 switch
  10:31 Account B -> usage B
```

If an event cannot be confidently attributed:
- store it under a special `unattributed` state; or
- skip it and expose the count in diagnostics.

Do not silently assign uncertain historical usage.

## 12.5 Watching rollout files

Create:

```ts
class RolloutWatcher
class RolloutTailer
class TokenCountParser
class UsageAttributionService
```

Requirements:
- incremental tailing by byte offset;
- no full-file reads;
- detect new rollout files;
- detect rename/archive;
- persist cursor positions;
- tolerate partial final JSONL lines;
- tolerate malformed lines;
- avoid parsing huge non-token lines.

Because Codex rollout lines can become very large, optimize for token events:

1. Read incrementally.
2. Split only on complete newlines.
3. Inspect a bounded prefix for the expected `event_msg` / `token_count` shape.
4. Only `JSON.parse` candidate token-count lines.
5. Put a maximum candidate line size in diagnostics.
6. Never load entire rollout files into memory.

File watching strategy:
- use a robust recursive watcher such as `chokidar`, or;
- watcher + periodic reconciliation scan.

Periodic reconciliation is important because filesystem watchers can miss events.

Suggested reconciliation cadence:
- event-driven normally;
- scan directory metadata every 10–30 seconds;
- no reading from offset 0 unless a file is new and backfill is enabled.

## 12.6 Token fields

Store at minimum:

```text
input_tokens
cached_input_tokens
output_tokens
```

Optionally parse but do not show by default:
- reasoning output tokens;
- total tokens;
- model;
- thread/session ID.

Clarify in the UI:

> These counters represent locally observed Codex token events. They are not guaranteed to equal ChatGPT subscription quota, billing, or rate-limit consumption.

---

## 13. SQLite Design

Database:

```text
~/.codex/cma/usage.sqlite
```

Enable:
- WAL mode;
- foreign keys;
- busy timeout.

### `profiles`

```sql
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  account_address TEXT,
  chatgpt_user_id TEXT,
  account_id TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
```

Keep deleted rows for historical usage joins.

### `account_switches`

```sql
CREATE TABLE account_switches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT,
  account_address TEXT,
  active_from TEXT NOT NULL,
  active_until TEXT,
  reason TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);
```

Only one open interval should exist at a time.

### `usage_events`

This table satisfies the requested data model while adding deduplication metadata.

```sql
CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  profile_id TEXT,
  account_address TEXT NOT NULL,

  working_directory TEXT NOT NULL,

  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,

  interaction_timestamp TEXT NOT NULL,

  session_id TEXT,
  rollout_path TEXT NOT NULL,
  rollout_ordinal INTEGER,
  source_fingerprint TEXT NOT NULL,

  created_at TEXT NOT NULL,

  FOREIGN KEY (profile_id) REFERENCES profiles(id),
  UNIQUE (source_fingerprint)
);
```

Required user-facing fields:
- Account Address
- Working Directory
- Input Tokens
- Cached Input Tokens
- Output Tokens
- Timestamp of Interaction

Additional fields exist to make ingestion idempotent.

### `usage_cursors`

```sql
CREATE TABLE usage_cursors (
  rollout_path TEXT PRIMARY KEY,
  file_identity TEXT,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  partial_line TEXT,

  last_input_total INTEGER NOT NULL DEFAULT 0,
  last_cached_input_total INTEGER NOT NULL DEFAULT 0,
  last_output_total INTEGER NOT NULL DEFAULT 0,
  last_total_tokens INTEGER,

  last_event_timestamp TEXT,
  epoch INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
```

If `partial_line` can become large, keep it in memory and persist only a bounded fragment or safe offset strategy.

### Indexes

```sql
CREATE INDEX idx_usage_profile_time
ON usage_events(profile_id, interaction_timestamp);

CREATE INDEX idx_usage_address_time
ON usage_events(account_address, interaction_timestamp);

CREATE INDEX idx_switches_time
ON account_switches(active_from, active_until);
```

### Migration table

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

All schema changes must be migrations.

---

## 14. Usage Webview

Command:

```text
CMA: Show Usage
```

Open:

```ts
vscode.window.createWebviewPanel(...)
```

### v1 UI

Header:
```text
Codex Usage
```

Controls:
- Account selector: Current / specific profile / All Accounts
- Period: Today / 7 days / 30 days / All time
- Refresh

Three primary cards:

```text
Input Tokens
1,234,567

Cached Input Tokens
9,876,543

Output Tokens
234,567
```

Below cards, optional table:

```text
Timestamp | Account | Input | Cached Input | Output
```

### Data boundary

The webview never reads SQLite directly.

Flow:

```text
Webview -> postMessage(request)
Extension host -> UsageRepository query
Extension host -> postMessage(result)
Webview -> render
```

Never send auth material to the webview.

### Security

Use:
- strict Content Security Policy;
- nonce for scripts;
- localResourceRoots;
- escaped text;
- no remote scripts;
- no inline arbitrary HTML from profile names.

---

## 15. Proposed Source Layout

```text
codex-account-manager/
├── package.json
├── tsconfig.json
├── esbuild.js
├── README.md
├── CHANGELOG.md
├── LICENSE
├── src/
│   ├── extension.ts
│   │
│   ├── config/
│   │   ├── paths.ts
│   │   └── codexConfigService.ts
│   │
│   ├── accounts/
│   │   ├── accountTypes.ts
│   │   ├── accountRepository.ts
│   │   ├── accountService.ts
│   │   ├── accountIdentity.ts
│   │   ├── authFile.ts
│   │   ├── authSyncService.ts
│   │   ├── switchService.ts
│   │   ├── signInService.ts
│   │   └── lockService.ts
│   │
│   ├── usage/
│   │   ├── database.ts
│   │   ├── migrations.ts
│   │   ├── usageRepository.ts
│   │   ├── rolloutWatcher.ts
│   │   ├── rolloutTailer.ts
│   │   ├── tokenCountParser.ts
│   │   └── attributionService.ts
│   │
│   ├── ui/
│   │   ├── accountsTreeProvider.ts
│   │   ├── accountTreeItem.ts
│   │   ├── statusBar.ts
│   │   ├── usagePanel.ts
│   │   └── usageHtml.ts
│   │
│   ├── commands/
│   │   ├── registerCommands.ts
│   │   └── ...
│   │
│   ├── infra/
│   │   ├── atomicFile.ts
│   │   ├── permissions.ts
│   │   ├── logger.ts
│   │   └── process.ts
│   │
│   └── diagnostics/
│       └── diagnosticsService.ts
│
├── test/
│   ├── unit/
│   ├── fixtures/
│   │   ├── auth/
│   │   └── rollouts/
│   └── integration/
└── resources/
    └── icon.svg
```

---

## 16. Suggested TypeScript Interfaces

```ts
export interface AccountProfile {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  identity?: {
    email?: string;
    chatgptUserId?: string;
    accountId?: string;
  };
}

export interface AccountState {
  profile: AccountProfile;
  signedIn: boolean;
  selected: boolean;
  liveAuthMatches: boolean;
}

export interface TokenUsageDelta {
  inputTokens: bigint;
  cachedInputTokens: bigint;
  outputTokens: bigint;
}

export interface ParsedTokenEvent {
  timestamp: string;
  sessionId?: string;
  ordinal?: number;
  total: TokenUsageDelta;
  last?: TokenUsageDelta;
}

export interface UsageRecord {
  profileId?: string;
  accountAddress: string;
  inputTokens: bigint;
  cachedInputTokens: bigint;
  outputTokens: bigint;
  interactionTimestamp: string;
  rolloutPath: string;
  sourceFingerprint: string;
}
```

Use `bigint` in parsing/aggregation code even if expected counts fit JavaScript safe integers.

Convert to SQLite integers only after bounds validation.

---

## 17. `package.json` Contributions

Conceptual contribution structure:

```json
{
  "contributes": {
    "commands": [
      { "command": "cma.account.add", "title": "CMA: Add Account" },
      { "command": "cma.account.signIn", "title": "CMA: Sign In" },
      { "command": "cma.account.signOut", "title": "CMA: Sign Out" },
      { "command": "cma.account.select", "title": "CMA: Select Account" },
      { "command": "cma.account.rename", "title": "CMA: Rename Account" },
      { "command": "cma.account.delete", "title": "CMA: Delete Account" },
      { "command": "cma.usage.show", "title": "CMA: Show Usage" }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "cma",
          "title": "Codex Accounts",
          "icon": "resources/icon.svg"
        }
      ]
    },
    "views": {
      "cma": [
        {
          "id": "cma.accounts",
          "name": "Accounts"
        }
      ]
    },
    "menus": {
      "view/title": [],
      "view/item/context": []
    }
  }
}
```

Actual menu `when` expressions should be tied to the context values defined earlier.

---

## 18. Activation Strategy

CMA should activate early enough to:
- synchronize selected live auth;
- record account-selection intervals;
- start usage tailing.

Recommended:
- activate on startup completion;
- also activate on CMA view and CMA commands.

On activation:

```text
1. Resolve ~/.codex paths.
2. Ensure ~/.codex/cma directories.
3. Initialize sanitized logger.
4. Initialize SQLite + migrations.
5. Load/reconcile profiles.
6. Verify Codex file-backed auth configuration.
7. Reconcile live auth with selected profile.
8. Register TreeView + commands + status bar.
9. Start live auth watcher.
10. Start rollout watcher/tailer.
11. Refresh UI.
```

---

## 19. Native SQLite Packaging Decision

Recommended v1: `better-sqlite3`.

Benefits:
- simple synchronous transactional API;
- real SQLite database;
- WAL support;
- mature behavior.

Cost:
- native binary packaging.

Release pipeline must build/package target-specific VSIX artifacts for:
- Windows x64/arm64 as desired;
- macOS x64/arm64;
- Linux x64/arm64 as desired.

Alternative if native packaging becomes painful:
- use a WASM SQLite implementation that writes a real `.sqlite` file.

Do not replace the requested SQLite DB with JSON merely to avoid packaging work.

---

## 20. Remote / WSL / SSH Behavior

CMA must operate on the same filesystem where the native Codex runtime's `~/.codex` lives.

For VS Code Remote:
- install/run CMA in the appropriate remote extension host;
- resolve `os.homedir()` in that host;
- show the resolved Codex home in diagnostics.

Add diagnostics:

```text
Codex Home: /home/user/.codex
CMA Home:   /home/user/.codex/cma
Auth:       file-backed / missing / mismatch
Selected:   Work
Usage DB:   OK
Watcher:    running
```

Never include token values.

---

## 21. Error and Conflict Handling

### Missing `~/.codex`

Create it only when needed.

### Missing `config.toml`

CMA may create a minimal config only after user action if file-backed auth must be enabled.

### Live auth is unmanaged

Offer:
- Import Current Account;
- keep unmanaged;
- sign out.

### Target profile auth is malformed

Do not switch.
Mark profile with warning.
Offer Sign In again.

### Live auth changed during switch

Abort/rollback.

### Multiple windows switch simultaneously

One wins lock.
Other shows:
```text
Another CMA window is changing the active Codex account.
```

### SQLite unavailable/corrupt

Account switching must continue to work.
Usage tracking can enter degraded mode.
Offer diagnostics and backup/rebuild DB action.

### Rollout schema changed

Skip unknown events.
Log schema diagnostic.
Do not crash the extension host.
Show `Usage tracking degraded` in diagnostics.

---

## 22. Security Requirements

1. `~/.codex/cma` directory:
   - Unix: prefer `0700`.
2. Profile `auth.json`:
   - Unix: prefer `0600`.
3. Temporary auth files:
   - same restrictive permissions.
4. Atomic rename instead of truncate/write live auth where possible.
5. No secrets in:
   - logs;
   - SQLite;
   - notifications;
   - webviews;
   - crash messages.
6. Validate paths to prevent traversal.
7. Never execute profile names as shell text.
8. Spawn `codex` with argument arrays, not concatenated shell commands.
9. Do not implement OAuth token refresh manually.
10. Keep dependency count small and audit release dependencies.
11. Add `.vscodeignore` / packaging checks so test auth fixtures are fake only.
12. Add a CI secret scan.

---

## 23. Performance Requirements

Account operations:
- normal tree refresh under 100 ms excluding login/reload;
- switching performs only small auth/profile file I/O.

Usage collector:
- never rescan entire session history during normal operation;
- tail from stored byte offsets;
- batch SQLite writes;
- commit every small event batch;
- avoid parsing huge non-token rollout records;
- debounce filesystem notifications;
- tolerate multi-GB session directories.

Webview:
- aggregate in SQL;
- paginate interaction rows;
- never send every event for all time to the UI at once.

---

## 24. Testing Strategy

## 24.1 Unit tests

### Profiles
- create valid profile;
- sanitize slug;
- collision handling;
- rename;
- stable ID across rename;
- delete;
- signed-in detection.

### Auth
- structural validation;
- identity extraction;
- fingerprint;
- atomic swap;
- rollback on failed rename;
- no token values in errors.

### Sync
- live auth refresh updates selected profile;
- mismatched identity does not overwrite profile;
- startup recovery;
- unmanaged live account.

### Token parser
Fixtures for:
- normal token event;
- missing cached tokens;
- repeated `last_token_usage` with unchanged total;
- cumulative advance;
- cumulative reset;
- partial JSONL line;
- malformed line;
- very large non-token line;
- archived file;
- duplicate filesystem notification.

### Attribution
- Account A event;
- switch;
- Account B event in same rollout;
- event exactly at switch boundary;
- unknown interval.

### Database
- migrations;
- uniqueness/dedup;
- aggregate totals;
- profile rename history;
- soft-deleted profile history.

## 24.2 Integration tests

Use fake Codex home:

```text
/tmp/cma-test-home/.codex
```

Set up:
- fake config;
- fake auth profiles;
- fake live auth;
- fake rollout writer.

Test complete:
1. select A;
2. append A token event;
3. live auth refresh;
4. switch to B;
5. append B token event to same rollout;
6. verify profile A saved refreshed auth;
7. verify live auth is B;
8. verify SQLite totals split correctly.

## 24.3 VS Code extension tests

Use VS Code extension testing framework to verify:
- TreeView rendering;
- context menu command enablement;
- command registration;
- usage webview opens;
- status bar changes.

## 24.4 Manual real-Codex test matrix

Platforms:
- macOS;
- Windows;
- Linux;
- WSL if supported.

Scenarios:
- two ChatGPT accounts;
- repeated switches;
- token refresh before switch;
- conversation continued after account switch;
- two VS Code windows;
- current account externally logged out;
- native Codex extension update;
- large existing `sessions/` directory.

Never use production auth files in automated tests.

---

## 25. Observability and Diagnostics

Create an output channel:

```text
Codex Account Manager
```

Allowed logs:
```text
[info] Selected profile "Work"
[info] Auth file changed; synchronized selected profile
[info] Parsed 3 new token usage events
[warn] Rollout schema event skipped
```

Forbidden:
```text
access_token=...
refresh_token=...
<full auth.json>
```

`CMA: Auth Diagnostics` should report:

```text
CMA version
VS Code version
Platform
Resolved Codex home
Config exists
Credential storage mode
Live auth exists
Live auth structurally valid
Selected profile
Live/profile identity match
Live/profile fingerprint match (boolean only)
SQLite health
Watcher health
Pending parser errors count
```

Support a **Copy Diagnostics** button that redacts:
- email optionally;
- account/user IDs optionally;
- paths optionally;
- all secrets always.

---

## 26. Versioning and Compatibility

CMA is intentionally coupled to local Codex storage conventions.

Create compatibility adapters:

```ts
interface CodexAuthAdapter {
  detect(...): Promise<...>;
}

interface CodexRolloutAdapter {
  canParse(line: string): boolean;
  parseTokenEvent(line: string): ParsedTokenEvent | undefined;
}
```

Record the detected Codex version when possible.

If a Codex update changes:
- auth structure;
- session path;
- token event shape;

CMA should fail closed for auth mutation and fail soft for usage parsing.

Account switching should never overwrite an auth file it cannot validate.

---

## 27. MVP Scope

### MVP must include

- Account TreeView.
- Add profile.
- Rename profile.
- Delete profile.
- Sign In via Codex-managed login.
- Sign Out.
- Select account.
- Live auth synchronization.
- Atomic auth switching.
- multi-window switch lock.
- current profile status bar.
- file-backed auth diagnostic.
- usage SQLite database.
- incremental rollout watcher.
- duplicate-safe token accounting.
- account switch timeline.
- Show Usage webview with three counters.
- basic diagnostics.
- unit and integration tests.

### Explicitly not MVP

- Cloud Codex quota/billing reconstruction.
- Exact monetary cost calculation.
- Multiple simultaneously active Codex accounts.
- Replacing native Codex chat UI.
- Editing MCPs.
- Editing general Codex config.
- Historical usage import by default.
- Syncing CMA profiles between machines.
- automatic browser automation for login.

---

## 28. Acceptance Criteria

### Accounts

- [ ] A profile can be created with Account Name only.
- [ ] Profile is stored under `~/.codex/cma/accounts/<profile-name-or-slug>`.
- [ ] User can rename it without losing usage history.
- [ ] User can delete it.
- [ ] Signed-out profile exposes **Sign In**.
- [ ] Signed-in profile exposes **Sign Out**.
- [ ] Signed-in non-current profile exposes **Select Account**.
- [ ] Selecting a profile updates `~/.codex/auth.json`.
- [ ] `~/.codex/config.toml` is never swapped per account.
- [ ] MCP configuration remains shared.
- [ ] Active refreshed auth is saved back to its profile.
- [ ] Switching never logs or stores raw tokens outside auth files.
- [ ] Two VS Code windows cannot corrupt a switch.

### Native Codex compatibility

- [ ] After the required reload, native Codex uses the selected profile.
- [ ] Existing local Codex sessions are not moved or rewritten by CMA.
- [ ] Existing shared config/MCPs remain intact.

### Usage

- [ ] `~/.codex/cma/usage.sqlite` is created.
- [ ] New token usage events are ingested incrementally.
- [ ] Input tokens are stored.
- [ ] Cached input tokens are stored.
- [ ] Output tokens are stored.
- [ ] Interaction timestamp is stored.
- [ ] Account address/profile attribution is stored.
- [ ] Duplicate token-count events do not inflate totals.
- [ ] Switching accounts inside the same Codex conversation attributes later events to the newly selected account.
- [ ] Usage page shows totals from SQLite.
- [ ] Usage tracking failure does not break account switching.

---

## 29. Recommended Build Order

### Phase 0 — Spike the two risky integrations

Before building UI, prove:

1. A fake/real profile auth can be copied into `~/.codex/auth.json` and native Codex reads the new identity after a reload.
2. A current native Codex VS Code session produces parseable `token_count` events in local rollouts.

Deliverable:
```text
docs/spike-results.md
```

This phase prevents spending time on UI before validating the two external integration assumptions.

### Phase 1 — Core profile store

Implement:
- paths;
- profile repository;
- account naming;
- profile state;
- auth validation/fingerprint;
- secure permissions;
- atomic file helpers.

### Phase 2 — Account switch engine

Implement:
- selected account;
- sync active auth;
- locking;
- atomic switch;
- rollback;
- reload flow.

Test heavily before adding UI.

### Phase 3 — Sign in/out

Implement:
- Codex-managed login staging;
- profile import;
- sign out;
- current unmanaged auth import.

### Phase 4 — TreeView and status bar

Implement:
- accounts sidebar;
- right-click commands;
- view title buttons;
- Quick Pick account switching.

### Phase 5 — Usage collector

Implement:
- SQLite;
- migrations;
- watchers;
- tail cursors;
- token parser;
- cumulative dedup;
- account attribution.

### Phase 6 — Usage UI

Implement:
- Show Usage webview;
- aggregate queries;
- filters;
- interaction list.

### Phase 7 — Hardening

Implement:
- multi-window races;
- crash recovery;
- remote/WSL;
- malformed files;
- huge rollouts;
- diagnostics;
- compatibility handling.

### Phase 8 — Packaging/release

Implement:
- native SQLite target builds;
- CI;
- VSIX packaging;
- secret scanning;
- changelog;
- installation docs.

---

## 30. Main Risks and Mitigations

### Risk: Native Codex does not immediately reload changed auth

**Mitigation:** make reload an explicit part of the switch transaction UX; keep a future Codex integration adapter behind a feature flag.

### Risk: Refresh token becomes stale in stored profile

**Mitigation:** live auth watcher + mandatory sync-before-switch + startup reconciliation.

### Risk: Codex uses keyring instead of `auth.json`

**Mitigation:** detect and require file-backed credentials before enabling profile switching.

### Risk: Token rollout schema changes

**Mitigation:** adapter abstraction, tolerant parser, fixture tests, diagnostics, fail-soft usage ingestion.

### Risk: Usage overcount from repeated token events

**Mitigation:** derive deltas from cumulative advancement; never blindly sum every `last_token_usage`.

### Risk: Usage attribution after account switch

**Mitigation:** persist account-selection intervals and use rollout timestamps for every accepted token delta.

### Risk: Very large session files

**Mitigation:** byte-offset tailing, bounded candidate inspection, no full-file read, database cursors.

### Risk: Two VS Code windows switch accounts

**Mitigation:** inter-process lock and atomic filesystem operations.

### Risk: Auth secrets leak

**Mitigation:** restrictive permissions, sanitized logger, no auth in DB/webview, fake-only test fixtures.

---

## 31. Definition of Done

CMA is ready for a v0.1 release when:

1. Two accounts can be signed in once and stored as separate profiles.
2. The user can switch between them from the sidebar/status bar without re-authenticating.
3. The live Codex `~/.codex/auth.json` always reflects the selected profile after the switch/reload.
4. Refreshed credentials are persisted back to the selected profile.
5. `~/.codex/config.toml` and MCPs are unchanged during account switches.
6. A native Codex conversation can continue while CMA changes which account authenticates subsequent turns, subject to native Codex compatibility.
7. New local token events are tracked into `usage.sqlite`.
8. Usage remains correctly separated by account even when a switch occurs inside one local session.
9. Repeated token-count snapshots do not inflate totals.
10. The usage webview shows Input, Cached Input, and Output totals.
11. No raw authentication token appears in logs, SQLite, webviews, or diagnostics.
12. Crash/restart and two-window switch tests pass.
