import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { mkdir } from "node:fs/promises";
import { rename, rm } from "node:fs/promises";
import { applyMigrations, migrations, type MigrationDatabase } from "./migrations.js";
import { secureFilePermissions } from "../infra/permissions.js";

export interface SqliteDatabase extends MigrationDatabase {
  pragma?(statement: string): unknown;
  close?(): void;
}

export interface UsageDatabaseOptions {
  driver?: (filePath: string) => SqliteDatabase;
}

export interface UsageDatabaseHealth {
  isOpen: boolean;
  schemaHealthy: boolean;
  schemaVersion: number;
  error?: string;
}

export class UsageDatabase {
  private database?: SqliteDatabase;

  constructor(
    private readonly filePath: string,
    private readonly options: UsageDatabaseOptions = {},
  ) {}

  async open(): Promise<SqliteDatabase> {
    if (this.database) return this.database;
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const database = this.options.driver?.(this.filePath) ?? defaultDriver(this.filePath);
    try {
      if (database.pragma) {
        database.pragma("foreign_keys = ON");
        database.pragma("journal_mode = WAL");
        database.pragma("busy_timeout = 5000");
      } else {
        database.exec(
          "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
        );
      }
      applyMigrations(database);
      this.database = database;
      return database;
    } catch (error) {
      try {
        database.close?.();
      } catch {
        // Preserve the initialization error and allow a later reopen.
      }
      throw error;
    }
  }

  close(): void {
    const database = this.database;
    this.database = undefined;
    try {
      database?.close?.();
    } catch {
      // The wrapper is closed even if the driver reports a close failure.
    }
  }

  async check(): Promise<UsageDatabaseHealth> {
    try {
      const database = await this.open();
      try {
        const version = Number(
          database.prepare("SELECT MAX(version) AS version FROM schema_migrations").all()[0]
            ?.version ?? 0,
        );
        const integrity = database.prepare("PRAGMA integrity_check").all()[0];
        const integrityResult = integrity ? String(Object.values(integrity)[0] ?? "") : "";
        return {
          isOpen: true,
          schemaHealthy: version === migrations.length && integrityResult === "ok",
          schemaVersion: version,
        };
      } catch (error) {
        return {
          isOpen: true,
          schemaHealthy: false,
          schemaVersion: 0,
          error: errorMessage(error),
        };
      }
    } catch (error) {
      return {
        isOpen: false,
        schemaHealthy: false,
        schemaVersion: 0,
        error: errorMessage(error),
      };
    }
  }

  async reopen(): Promise<SqliteDatabase> {
    this.close();
    return this.open();
  }

  async backup(targetPath: string): Promise<void> {
    if (path.resolve(targetPath) === path.resolve(this.filePath)) {
      throw new Error("Backup target must differ from the usage database.");
    }
    const database = await this.open();
    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    const temporary = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.tmp-${process.pid}-${randomUUID()}`,
    );
    try {
      database.prepare("VACUUM INTO ?").run(temporary);
      await secureFilePermissions(temporary);
      await rename(temporary, targetPath);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  get isOpen(): boolean {
    return this.database !== undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultDriver(filePath: string): SqliteDatabase {
  const require = createRequire(__filename);
  try {
    const Database = require("better-sqlite3");
    return new Database(filePath) as SqliteDatabase;
  } catch (betterSqliteError) {
    try {
      const { DatabaseSync } = require("node:sqlite") as {
        DatabaseSync: new (path: string) => SqliteDatabase;
      };
      return new DatabaseSync(filePath);
    } catch {
      throw new Error(
        `SQLite support is unavailable; install better-sqlite3 for the extension host. ${String(betterSqliteError)}`,
      );
    }
  }
}
