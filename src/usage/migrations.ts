export interface MigrationDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...parameters: unknown[]): readonly Record<string, unknown>[];
    run(...parameters: unknown[]): unknown;
  };
}

export const migrations: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    account_address TEXT,
    chatgpt_user_id TEXT,
    account_id TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS account_switches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT,
    account_address TEXT,
    active_from TEXT NOT NULL,
    active_until TEXT,
    reason TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
  );
  CREATE INDEX IF NOT EXISTS idx_switches_time
    ON account_switches(active_from, active_until);`,
  `CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT,
    account_address TEXT NOT NULL,
    working_directory TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    interaction_timestamp TEXT NOT NULL,
    session_id TEXT,
    rollout_path TEXT NOT NULL,
    rollout_ordinal INTEGER,
    source_fingerprint TEXT NOT NULL,
    epoch INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id),
    UNIQUE (source_fingerprint)
  );
  CREATE INDEX IF NOT EXISTS idx_usage_profile_time
    ON usage_events(profile_id, interaction_timestamp);
  CREATE INDEX IF NOT EXISTS idx_usage_address_time
    ON usage_events(account_address, interaction_timestamp);`,
  `CREATE TABLE IF NOT EXISTS usage_cursors (
    rollout_path TEXT PRIMARY KEY,
    file_identity TEXT,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    partial_line TEXT NOT NULL DEFAULT '',
    last_input_total INTEGER NOT NULL DEFAULT 0,
    last_cached_input_total INTEGER NOT NULL DEFAULT 0,
    last_output_total INTEGER NOT NULL DEFAULT 0,
    last_total_tokens INTEGER,
    last_event_timestamp TEXT,
    epoch INTEGER NOT NULL DEFAULT 0,
    initialized INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );`,
  `ALTER TABLE usage_cursors ADD COLUMN working_directory TEXT;`,
  `ALTER TABLE usage_events ADD COLUMN model TEXT NOT NULL DEFAULT 'unknown';
   ALTER TABLE usage_cursors ADD COLUMN model TEXT;`,
];

export function applyMigrations(database: MigrationDatabase): number {
  database.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
  );
  const applied = new Set(
    database
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => Number(row.version)),
  );

  for (let index = 0; index < migrations.length; index += 1) {
    const version = index + 1;
    if (applied.has(version)) continue;
    database.exec("BEGIN");
    try {
      database.exec(migrations[index]);
      database
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(version, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return migrations.length;
}
