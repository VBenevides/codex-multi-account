import * as fs from "node:fs/promises";
import { AccountRepository } from "./accountRepository.js";
import { AuthSyncService } from "./authSyncService.js";
import { ReconciliationService } from "./reconciliationService.js";
import { LockService } from "./lockService.js";
import { parseAuthFile } from "./authFile.js";
import { readStateFile, writeStateFile } from "./accountService.js";
import { copyFileAtomic, writeAtomic } from "../infra/atomicFile.js";
import { resolvePaths, type CodexPaths } from "../config/paths.js";

export interface SwitchResult {
  profileId: string;
  profileSlug: string;
  fingerprint: string;
  changed: boolean;
}

export interface SwitchServiceOptions {
  repository?: AccountRepository;
  paths?: CodexPaths;
  lock?: LockService;
  sync?: AuthSyncService;
  reload?: () => Promise<void> | void;
  recordInterval?: (profileId: string, at: string) => Promise<void> | void;
}

export class SwitchService {
  private readonly repository: AccountRepository;
  private readonly paths: CodexPaths;
  private readonly lock: LockService;
  private readonly sync: AuthSyncService;

  constructor(private readonly options: SwitchServiceOptions = {}) {
    this.repository = options.repository ?? new AccountRepository(options.paths ?? resolvePaths());
    this.paths = options.paths ?? this.repository.paths;
    this.lock = options.lock ?? new LockService(this.paths.switchLockPath);
    this.sync = options.sync ?? new AuthSyncService(this.repository, this.paths);
  }

  async switchTo(profileId: string): Promise<SwitchResult> {
    const result = await this.lock.withLock(async () => {
      const target = await this.repository.getProfile(profileId);
      if (!target) throw new Error("Target profile not found.");
      if (!(await this.repository.profileAuthExists(target.id)))
        throw new Error("Target profile is signed out.");
      const state = await readStateFile(this.paths.statePath);
      const alreadySelected = state.selectedProfileId === target.id;
      if (alreadySelected) {
        const syncResult = await this.sync.syncSelected();
        if (
          syncResult.reason !== "ambiguous-identity" &&
          syncResult.reason !== "missing-live-auth"
        ) {
          const current = parseAuthFile(await fs.readFile(this.paths.liveAuthPath));
          return {
            profileId: target.id,
            profileSlug: target.slug,
            fingerprint: current.fingerprint.value,
            changed: false,
          };
        }
      }

      if (state.selectedProfileId && !alreadySelected) {
        const syncResult = await this.sync.syncSelected();
        if (syncResult.reason === "ambiguous-identity") {
          const repaired = await new ReconciliationService(
            this.repository,
            this.paths,
          ).repairSelectedState();
          if (!repaired.repaired)
            throw new Error("Current live auth does not match the selected profile.");
        }
      }
      const targetAuth = parseAuthFile(await this.repository.readProfileAuth(target.id));
      const rollbackPath = `${this.paths.liveAuthPath}.cma-rollback`;
      let previousState: Buffer | undefined;
      let hadLiveAuth = false;
      try {
        previousState = await fs.readFile(this.paths.statePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        try {
          await fs.access(this.paths.liveAuthPath);
          hadLiveAuth = true;
          await copyFileAtomic(this.paths.liveAuthPath, rollbackPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await writeAtomic(this.paths.liveAuthPath, targetAuth.bytes, { mode: 0o600 });
        const verified = parseAuthFile(await fs.readFile(this.paths.liveAuthPath));
        if (verified.fingerprint.value !== targetAuth.fingerprint.value)
          throw new Error("Auth replacement verification failed.");
        const selectedAt = new Date().toISOString();
        await writeStateFile(this.paths.statePath, {
          ...state,
          version: 1,
          selectedProfileId: target.id,
          selectedProfileSlug: target.slug,
          selectedAt,
          lastObservedLiveAuthFingerprint: verified.fingerprint.value,
        });
        await this.options.recordInterval?.(target.id, selectedAt);
        return {
          profileId: target.id,
          profileSlug: target.slug,
          fingerprint: verified.fingerprint.value,
          changed: true,
        };
      } catch (error) {
        try {
          if (hadLiveAuth) await copyFileAtomic(rollbackPath, this.paths.liveAuthPath);
          else await fs.unlink(this.paths.liveAuthPath);
        } catch {
          // Preserve the original failure; diagnostics can report the recovery problem.
        }
        try {
          if (previousState)
            await writeAtomic(this.paths.statePath, previousState, { mode: 0o600 });
          else await fs.unlink(this.paths.statePath);
        } catch {
          // Preserve the original failure; diagnostics can report the recovery problem.
        }
        throw error;
      } finally {
        await fs.unlink(rollbackPath).catch(() => undefined);
      }
    });
    if (result.changed) await this.options.reload?.();
    return result;
  }
}
