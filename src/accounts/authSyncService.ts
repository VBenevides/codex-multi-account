import { watch, type FSWatcher } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AccountRepository } from "./accountRepository.js";
import { sameKnownIdentity } from "./accountIdentity.js";
import { parseAuthFile } from "./authFile.js";
import { readStateFile, writeStateFile, type AccountStateFile } from "./accountService.js";
import { type CodexPaths, resolvePaths } from "../config/paths.js";

export interface AuthSyncResult {
  synced: boolean;
  fingerprint?: string;
  restored?: boolean;
  reason?: "no-selection" | "missing-live-auth" | "ambiguous-identity";
}

export interface AuthSyncOptions {
  restoreSelected?: boolean;
}

export class AuthSyncService {
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly repository = new AccountRepository(),
    private readonly paths: CodexPaths = repository.paths ?? resolvePaths(),
    private readonly debounceMs = 150,
  ) {}

  async syncSelected(options: AuthSyncOptions = {}): Promise<AuthSyncResult> {
    const state = await readStateFile(this.paths.statePath);
    if (!state.selectedProfileId) return { synced: false, reason: "no-selection" };
    let liveBytes: Buffer;
    try {
      liveBytes = await fs.readFile(this.paths.liveAuthPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { synced: false, reason: "missing-live-auth" };
      }
      throw error;
    }
    const live = parseAuthFile(liveBytes);
    const profile = await this.repository.getProfile(state.selectedProfileId);
    if (!profile) return { synced: false, reason: "no-selection" };

    if (await this.repository.profileAuthExists(profile.id)) {
      const stored = parseAuthFile(await this.repository.readProfileAuth(profile.id));
      if (!sameKnownIdentity(stored.structuredIdentity, live.structuredIdentity)) {
        if (options.restoreSelected) {
          await this.repository.copyProfileAuthTo(profile.id, this.paths.liveAuthPath);
          const restored = parseAuthFile(await fs.readFile(this.paths.liveAuthPath));
          if (restored.fingerprint.value !== stored.fingerprint.value)
            throw new Error("Selected auth restore verification failed.");
          await this.updateState(state, profile.slug, restored.fingerprint.value);
          return {
            synced: false,
            restored: true,
            fingerprint: restored.fingerprint.value,
          };
        }
        return { synced: false, reason: "ambiguous-identity", fingerprint: live.fingerprint.value };
      }
      if (stored.fingerprint.value === live.fingerprint.value) {
        await this.updateState(state, profile.slug, live.fingerprint.value);
        return { synced: false, fingerprint: live.fingerprint.value };
      }
    }

    await this.repository.writeProfileAuth(profile.id, liveBytes);
    await this.updateState(state, profile.slug, live.fingerprint.value);
    return { synced: true, fingerprint: live.fingerprint.value };
  }

  async start(): Promise<void> {
    if (this.watcher) return;
    await fs.mkdir(path.dirname(this.paths.liveAuthPath), { recursive: true, mode: 0o700 });
    this.watcher = watch(path.dirname(this.paths.liveAuthPath), (_event, filename) => {
      if (filename && filename.toString() !== path.basename(this.paths.liveAuthPath)) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(
        () => void this.syncSelected({ restoreSelected: true }).catch(() => undefined),
        this.debounceMs,
      );
      this.timer.unref?.();
    });
    await this.syncSelected({ restoreSelected: true }).catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.watcher?.close();
    this.watcher = undefined;
    await this.syncSelected().catch(() => undefined);
  }

  private async updateState(
    state: AccountStateFile,
    slug: string,
    fingerprint: string,
  ): Promise<void> {
    await writeStateFile(this.paths.statePath, {
      ...state,
      version: 1,
      selectedProfileSlug: slug,
      lastObservedLiveAuthFingerprint: fingerprint,
    });
  }
}
