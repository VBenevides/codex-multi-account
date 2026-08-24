import * as path from "node:path";
import { rm } from "node:fs/promises";
import { AccountRepository } from "../accounts/accountRepository.js";
import { readStateFile } from "../accounts/accountService.js";
import type { CodexPaths } from "../config/paths.js";
import { AttributionService } from "./attributionService.js";
import { UsageDatabase } from "./database.js";
import { RolloutTailer } from "./rolloutTailer.js";
import { findRollouts, RolloutWatcher } from "./rolloutWatcher.js";
import {
  UsageBreakdown,
  UsageDaily,
  UsageDailyOptions,
  UsageFilter,
  UsageFilterOptions,
  UsageRepository,
  UsageTotals,
  UnattributedUsageRange,
} from "./usageRepository.js";

export interface UsageHealth {
  watcherHealth: "running" | "stopped" | "error" | "unknown";
  parserFailureCount: number;
  degraded: boolean;
}

const EMPTY_TOTALS: UsageTotals = {
  inputTokens: 0n,
  cachedInputTokens: 0n,
  outputTokens: 0n,
};
export class UsageService {
  private readonly database: UsageDatabase;
  private readonly tailer = new RolloutTailer();
  private readonly attribution = new AttributionService();
  private watcher?: RolloutWatcher;
  private repository?: UsageRepository;
  private readonly consuming = new Map<string, Promise<void>>();
  private parserFailures = 0;
  private degraded = false;

  constructor(
    private readonly paths: CodexPaths,
    private readonly profiles = new AccountRepository(paths),
    database = new UsageDatabase(paths.usageDbPath),
    private readonly onDatabaseError?: (error: unknown) => void,
  ) {
    this.database = database;
  }

  async start(): Promise<void> {
    this.degraded = false;
    try {
      this.repository = new UsageRepository(await this.database.open());
      await this.syncProfiles();
      this.attribution.restore(this.repository.listIntervals());
      const state = await readStateFile(this.paths.statePath);
      if (state.selectedProfileId) {
        const selected = await this.profiles.getProfile(state.selectedProfileId);
        if (selected) {
          const now = new Date().toISOString();
          this.attribution.open(selected.id, selected.identity?.email ?? null, now);
          this.repository.startInterval(
            selected.id,
            selected.identity?.email ?? null,
            now,
            "startup",
          );
        }
      }
      for (const filePath of await findRollouts(path.join(this.paths.codexHome, "sessions")))
        await this.consume(filePath, true);
      this.watcher = new RolloutWatcher({
        root: path.join(this.paths.codexHome, "sessions"),
        onFile: (filePath) => this.consume(filePath),
        onError: (error) => this.reportFailure(error),
      });
      await this.watcher.start();
    } catch (error) {
      this.reportFailure(error);
      await this.stop();
    }
  }

  async switchTo(profileId: string, at = new Date().toISOString()): Promise<void> {
    const profile = await this.profiles.getProfile(profileId);
    if (!profile) return;
    this.attribution.open(profile.id, profile.identity?.email ?? null, at);
    try {
      this.repository?.upsertProfile({
        id: profile.id,
        name: profile.name,
        slug: profile.slug,
        email: profile.identity?.email,
        chatgptUserId: profile.identity?.chatgptUserId,
        accountId: profile.identity?.accountId,
        createdAt: profile.createdAt,
      });
      this.repository?.startInterval(profile.id, profile.identity?.email ?? null, at);
    } catch (error) {
      this.reportFailure(error);
      // Usage storage must never prevent an account switch.
    }
  }

  async closeInterval(profileId: string, at = new Date().toISOString()): Promise<void> {
    try {
      this.repository?.closeInterval(profileId, at);
      this.attribution.close(at);
    } catch (error) {
      this.reportFailure(error);
      // Usage storage must never prevent account sign-out.
    }
  }

  async syncProfile(profileId: string): Promise<void> {
    const profile = await this.profiles.getProfile(profileId);
    if (!profile) return;
    try {
      this.repository?.upsertProfile({
        id: profile.id,
        name: profile.name,
        slug: profile.slug,
        email: profile.identity?.email,
        chatgptUserId: profile.identity?.chatgptUserId,
        accountId: profile.identity?.accountId,
        createdAt: profile.createdAt,
      });
    } catch (error) {
      this.reportFailure(error);
      // Usage storage must never prevent profile changes.
    }
  }

  async deleteProfile(profileId: string): Promise<void> {
    try {
      this.repository?.softDeleteProfile(profileId);
    } catch (error) {
      this.reportFailure(error);
      // Usage storage must never prevent profile deletion.
    }
  }

  async rebuildDatabase(): Promise<void> {
    await this.stop();
    await rm(this.paths.usageDbPath, { force: true });
    await rm(`${this.paths.usageDbPath}-wal`, { force: true });
    await rm(`${this.paths.usageDbPath}-shm`, { force: true });
    await this.start();
  }

  async backupDatabase(targetPath: string): Promise<void> {
    await this.database.backup(targetPath);
  }

  async rescanFromNow(): Promise<void> {
    if (!this.repository) return;
    await this.watcher?.stop();
    this.watcher = undefined;
    await this.waitForConsumption();
    for (const filePath of await findRollouts(path.join(this.paths.codexHome, "sessions"))) {
      const result = await this.tailer.tail(filePath);
      this.parserFailures += result.diagnostics.length;
      if (result.diagnostics.length) this.degraded = true;
      this.repository.writeCursor(filePath, result.cursor);
    }
    this.watcher = new RolloutWatcher({
      root: path.join(this.paths.codexHome, "sessions"),
      onFile: (filePath) => this.consume(filePath),
      onError: (error) => this.reportFailure(error),
    });
    await this.watcher.start();
  }

  totals(filter: UsageFilter = {}): UsageTotals {
    return this.repository?.totals(filter) ?? EMPTY_TOTALS;
  }

  todayTotals(at = new Date(), filter: UsageFilter = {}): UsageTotals {
    return this.repository?.todayTotals(at, filter) ?? EMPTY_TOTALS;
  }

  breakdown(filter: UsageFilter = {}): UsageBreakdown[] {
    return this.repository?.breakdown(filter) ?? [];
  }

  filterOptions(filter: UsageFilter = {}): UsageFilterOptions {
    return this.repository?.filterOptions(filter) ?? { models: [], workingDirectories: [] };
  }

  daily(filter: UsageFilter = {}, options?: UsageDailyOptions): UsageDaily[] {
    return this.repository?.daily(filter, options) ?? [];
  }

  unattributedRanges(): UnattributedUsageRange[] {
    return this.repository?.unattributedRanges() ?? [];
  }

  async attributeUnknown(profileId: string, from: string, until: string): Promise<number> {
    const profile = await this.profiles.getProfile(profileId);
    if (!profile || !this.repository) return 0;
    return this.repository.attributeUnknown(
      profile.id,
      profile.identity?.email ?? null,
      from,
      until,
    );
  }

  get health(): UsageHealth {
    return {
      watcherHealth: this.degraded ? "error" : this.watcher?.isRunning ? "running" : "stopped",
      parserFailureCount: this.parserFailures,
      degraded: this.degraded,
    };
  }

  async stop(): Promise<void> {
    await this.watcher?.stop();
    this.watcher = undefined;
    await this.waitForConsumption();
    this.database.close();
    this.repository = undefined;
  }

  private async syncProfiles(): Promise<void> {
    if (!this.repository) return;
    for (const profile of await this.profiles.listProfiles()) {
      this.repository.upsertProfile({
        id: profile.id,
        name: profile.name,
        slug: profile.slug,
        email: profile.identity?.email,
        chatgptUserId: profile.identity?.chatgptUserId,
        accountId: profile.identity?.accountId,
        createdAt: profile.createdAt,
      });
    }
  }

  private consume(filePath: string, backfill = false): Promise<void> {
    const previous = this.consuming.get(filePath) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.consumeNow(filePath, backfill));
    this.consuming.set(filePath, current);
    const clear = () => {
      if (this.consuming.get(filePath) === current) this.consuming.delete(filePath);
    };
    void current.then(clear, clear);
    return current;
  }

  private async consumeNow(filePath: string, backfill = false): Promise<void> {
    const repository = this.repository;
    if (!repository) return;
    let cursor = repository.readCursor(filePath);
    const importHistory = backfill && (!cursor || !cursor.initialized);
    if (importHistory) cursor = undefined;
    const result = await this.tailer.tail(
      filePath,
      cursor,
      importHistory ? { startAt: "beginning", backfillFirst: true } : undefined,
    );
    this.parserFailures += result.diagnostics.length;
    if (result.diagnostics.length) this.degraded = true;
    const inputs = result.events.map((event) => {
      const interval = this.attribution.resolve(event.event.timestamp);
      return {
        profileId: interval?.profileId ?? null,
        accountAddress: interval?.accountAddress ?? null,
        rolloutPath: filePath,
        workingDirectory: result.cursor.workingDirectory,
        model: event.model ?? result.cursor.model,
        event,
      };
    });
    repository.insertUsageBatch(inputs, filePath, result.cursor);
  }

  private async waitForConsumption(): Promise<void> {
    await Promise.allSettled(this.consuming.values());
  }

  private reportFailure(error: unknown): void {
    this.degraded = true;
    this.onDatabaseError?.(error);
  }
}
