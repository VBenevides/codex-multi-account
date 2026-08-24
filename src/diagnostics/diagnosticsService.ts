import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AccountRepository } from "../accounts/accountRepository.js";
import { readStateFile } from "../accounts/accountService.js";
import { LockService } from "../accounts/lockService.js";
import { parseAuthFile, readAuthFile } from "../accounts/authFile.js";
import { type AuthStorageMode, CodexConfigService } from "../config/codexConfigService.js";
import type { CodexPaths } from "../config/paths.js";
import { resolvePaths } from "../config/paths.js";
import { ProcessRunner } from "../infra/process.js";
import { UsageDatabase } from "../usage/database.js";

export type DiagnosticHealth = "ok" | "missing" | "error" | "unknown";
export type DiagnosticWatcherHealth = "running" | "stopped" | "error" | "unknown";
export type DiagnosticLockState = "clear" | "active" | "stale" | "invalid";

export interface Diagnostics {
  cmaVersion: string | null;
  vscodeVersion: string | null;
  platform: string;
  arch: string;
  node: string;
  codexHome: string;
  cmaHome: string;
  configExists: boolean;
  credentialStorageMode: AuthStorageMode | "unknown";
  liveAuthExists: boolean;
  liveAuthValid: boolean;
  selectedProfile: { id: string; name: string; slug: string } | null;
  liveProfileMatch: boolean | null;
  usageDbExists: boolean;
  sqliteHealth: DiagnosticHealth;
  sqliteSchemaVersion: number | null;
  watcherHealth: DiagnosticWatcherHealth;
  parserFailureCount: number | null;
  usageDegraded: boolean;
  switchLock: DiagnosticLockState;
  currentCodexVersion: string | null;
}

export interface DiagnosticsServiceOptions {
  cmaVersion?: string | null;
  vscodeVersion?: string | null;
  codexVersion?: string | null;
  codexBinaryPath?: string;
  watcherHealth?: DiagnosticWatcherHealth;
  parserFailureCount?: number | null;
  usageDegraded?: boolean;
  processRunner?: ProcessRunner;
}

export class DiagnosticsService {
  constructor(
    private readonly paths: CodexPaths = resolvePaths(),
    private readonly options: DiagnosticsServiceOptions = {},
  ) {}

  async collect(): Promise<Diagnostics> {
    const [config, auth, sqlite, switchLock] = await Promise.all([
      this.inspectConfig(),
      this.inspectAuth(),
      this.inspectSqlite(),
      this.inspectSwitchLock(),
    ]);
    return {
      cmaVersion: this.options.cmaVersion ?? (await readPackageVersion()),
      vscodeVersion: this.options.vscodeVersion ?? discoverVscodeVersion(),
      platform: os.platform(),
      arch: os.arch(),
      node: process.version,
      codexHome: this.paths.codexHome,
      cmaHome: this.paths.cmaHome,
      configExists: config.exists,
      credentialStorageMode: config.mode,
      liveAuthExists: auth.exists,
      liveAuthValid: auth.valid,
      selectedProfile: auth.selected,
      liveProfileMatch: auth.match,
      usageDbExists: sqlite.exists,
      sqliteHealth: sqlite.health,
      sqliteSchemaVersion: sqlite.schemaVersion,
      watcherHealth: this.options.watcherHealth ?? "unknown",
      parserFailureCount: this.options.parserFailureCount ?? null,
      usageDegraded: this.options.usageDegraded ?? false,
      switchLock,
      currentCodexVersion: await this.codexVersion(),
    };
  }

  private async inspectConfig(): Promise<{
    exists: boolean;
    mode: AuthStorageMode | "unknown";
  }> {
    try {
      const result = await new CodexConfigService(this.paths.configPath).inspect();
      return { exists: result.exists, mode: result.configuredMode };
    } catch {
      return { exists: await this.exists(this.paths.configPath), mode: "unknown" };
    }
  }

  private async inspectAuth(): Promise<{
    exists: boolean;
    valid: boolean;
    selected: Diagnostics["selectedProfile"];
    match: boolean | null;
  }> {
    const repository = new AccountRepository(this.paths);
    let selected: Diagnostics["selectedProfile"] = null;
    let selectedId: string | undefined;
    try {
      const state = await readStateFile(this.paths.statePath);
      selectedId = state.selectedProfileId ?? undefined;
      if (selectedId) {
        const profile = await repository.getProfile(selectedId);
        if (profile) selected = { id: profile.id, name: profile.name, slug: profile.slug };
      }
    } catch {
      // A malformed state file should not prevent safe diagnostics.
    }

    const exists = await this.exists(this.paths.liveAuthPath);
    if (!exists) return { exists, valid: false, selected, match: null };

    let live;
    try {
      live = await readAuthFile(this.paths.liveAuthPath);
    } catch {
      return { exists, valid: false, selected, match: selected ? false : null };
    }
    if (!selected || !selectedId) return { exists, valid: true, selected, match: null };

    try {
      const stored = parseAuthFile(await repository.readProfileAuth(selectedId));
      return {
        exists,
        valid: true,
        selected,
        match: stored.fingerprint.value === live.fingerprint.value,
      };
    } catch {
      return { exists, valid: true, selected, match: false };
    }
  }

  private async inspectSqlite(): Promise<{
    exists: boolean;
    health: DiagnosticHealth;
    schemaVersion: number | null;
  }> {
    const exists = await this.exists(this.paths.usageDbPath);
    if (!exists) return { exists, health: "missing", schemaVersion: null };

    const database = new UsageDatabase(this.paths.usageDbPath);
    try {
      const result = await database.check();
      return {
        exists,
        health: result.isOpen ? (result.schemaHealthy ? "ok" : "error") : "error",
        schemaVersion: Number.isSafeInteger(result.schemaVersion) ? result.schemaVersion : null,
      };
    } catch {
      return { exists, health: "error", schemaVersion: null };
    } finally {
      database.close();
    }
  }

  private async inspectSwitchLock(): Promise<DiagnosticLockState> {
    if (!(await this.exists(this.paths.switchLockPath))) return "clear";
    const lock = new LockService(this.paths.switchLockPath);
    if (!(await lock.readInfo())) return "invalid";
    return (await lock.isStale()) ? "stale" : "active";
  }

  private async codexVersion(): Promise<string | null> {
    if (this.options.codexVersion !== undefined) return this.options.codexVersion;
    try {
      const runner = this.options.processRunner ?? new ProcessRunner();
      const binary = await runner.discover(this.options.codexBinaryPath);
      if (!binary) return null;
      const result = await runner.run(binary, ["--version"]);
      if (result.code !== 0) return null;
      return firstLine(result.stdout || result.stderr);
    } catch {
      return null;
    }
  }

  private async exists(file: string): Promise<boolean> {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }
}

async function readPackageVersion(): Promise<string | null> {
  const candidates = [
    path.join(__dirname, "..", "package.json"),
    path.join(__dirname, "..", "..", "..", "package.json"),
    path.join(process.cwd(), "package.json"),
  ];
  for (const file of new Set(candidates)) {
    try {
      const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      const version =
        value && typeof value === "object" ? (value as { version?: unknown }).version : undefined;
      if (
        typeof version === "string" &&
        version.length <= 64 &&
        !/[\u0000-\u001f\u007f]/u.test(version)
      )
        return version;
    } catch {
      // Try the next known package location.
    }
  }
  return null;
}

function discoverVscodeVersion(): string | null {
  try {
    const vscode = require("vscode") as { version?: unknown };
    return typeof vscode.version === "string" ? vscode.version : null;
  } catch {
    return null;
  }
}

function firstLine(value: string): string | null {
  const line = value
    .replace(/[\u001b\u009b]\[[0-?]*[ -/]*[@-~]/gu, "")
    .split(/\r?\n/u)[0]
    ?.trim();
  return line && line.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(line) ? line : null;
}
