import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AccountRepository } from "./accountRepository.js";
import { sameKnownIdentity } from "./accountIdentity.js";
import { LockService } from "./lockService.js";
import { parseAuthFile } from "./authFile.js";
import { readStateFile, writeStateFile } from "./accountService.js";
import { copyFileAtomic, writeAtomic } from "../infra/atomicFile.js";
import { resolvePaths, resolveProfilePaths, type CodexPaths } from "../config/paths.js";

export interface SignOutResult {
  profileId: string;
  profileSlug: string;
  selected: boolean;
  changed: boolean;
}

export interface SignOutServiceOptions {
  repository?: AccountRepository;
  paths?: CodexPaths;
  lock?: LockService;
  now?: () => Date;
  closeInterval?: (profileId: string, at: string) => Promise<void> | void;
  reload?: () => Promise<void> | void;
}

export class SignOutService {
  private readonly repository: AccountRepository;
  private readonly paths: CodexPaths;
  private readonly lock: LockService;
  private readonly now: () => Date;

  constructor(private readonly options: SignOutServiceOptions = {}) {
    this.repository = options.repository ?? new AccountRepository(options.paths ?? resolvePaths());
    this.paths = options.paths ?? this.repository.paths;
    this.lock = options.lock ?? new LockService(this.paths.switchLockPath);
    this.now = options.now ?? (() => new Date());
  }

  async signOut(profileId: string): Promise<SignOutResult> {
    return this.lock.withLock(() => this.signOutWithLockHeld(profileId));
  }

  async signOutWithLockHeld(profileId: string): Promise<SignOutResult> {
    const profile = await this.repository.getProfile(profileId);
    if (!profile) throw new Error("Profile not found.");

    const state = await readStateFile(this.paths.statePath);
    if (state.selectedProfileId !== profile.id) {
      const changed = await this.repository.profileAuthExists(profile.id);
      await this.repository.deleteProfileAuth(profile.id);
      return { profileId: profile.id, profileSlug: profile.slug, selected: false, changed };
    }

    return this.signOutSelected(profile.id);
  }

  private async signOutSelected(profileId: string): Promise<SignOutResult> {
    const state = await readStateFile(this.paths.statePath);
    const profile = await this.repository.getProfile(profileId);
    if (!profile) throw new Error("Profile not found.");
    if (state.selectedProfileId !== profile.id) {
      const changed = await this.repository.profileAuthExists(profile.id);
      await this.repository.deleteProfileAuth(profile.id);
      return { profileId: profile.id, profileSlug: profile.slug, selected: false, changed };
    }

    if (!(await this.repository.profileAuthExists(profile.id)))
      throw new Error("Selected profile has no stored auth.");

    let stored;
    try {
      stored = parseAuthFile(await this.repository.readProfileAuth(profile.id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("Selected profile has no stored auth.");
      throw error;
    }

    let live;
    try {
      live = parseAuthFile(await readFile(this.paths.liveAuthPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("Selected profile live auth is missing.");
      throw error;
    }

    if (
      stored.fingerprint.value !== live.fingerprint.value &&
      !sameKnownIdentity(stored.structuredIdentity, live.structuredIdentity)
    ) {
      throw new Error("Selected profile does not own the live auth.");
    }

    const storedAuthPath = resolveProfilePaths(this.paths, profile.slug).authPath;
    const suffix = `.cma-signout-rollback-${randomUUID()}`;
    const storedBackupPath = `${storedAuthPath}${suffix}`;
    const liveBackupPath = `${this.paths.liveAuthPath}${suffix}`;
    const stateBackupPath = `${this.paths.statePath}${suffix}`;
    let hadState = false;

    try {
      hadState = await backupIfPresent(this.paths.statePath, stateBackupPath);
      await writeAtomic(storedBackupPath, stored.bytes, { mode: 0o600 });
      await writeAtomic(liveBackupPath, live.bytes, { mode: 0o600 });
      await unlink(storedAuthPath);
      await unlink(this.paths.liveAuthPath);
      const signedOutAt = this.now().toISOString();
      await writeStateFile(this.paths.statePath, {
        ...state,
        version: 1,
        selectedProfileId: null,
        selectedProfileSlug: null,
        selectedAt: null,
        lastObservedLiveAuthFingerprint: null,
      });
      await this.options.closeInterval?.(profile.id, signedOutAt);
      await this.options.reload?.();
      return { profileId: profile.id, profileSlug: profile.slug, selected: true, changed: true };
    } catch (error) {
      let rollbackIncomplete = false;
      if (await fileExists(storedBackupPath))
        rollbackIncomplete = !(await tryRestore(storedBackupPath, storedAuthPath));
      if (await fileExists(liveBackupPath))
        rollbackIncomplete =
          !(await tryRestore(liveBackupPath, this.paths.liveAuthPath)) || rollbackIncomplete;
      if (hadState)
        rollbackIncomplete =
          !(await tryRestore(stateBackupPath, this.paths.statePath)) || rollbackIncomplete;
      else if (
        (await fileExists(this.paths.statePath)) &&
        !(await removeIfPresent(this.paths.statePath))
      )
        rollbackIncomplete = true;
      if (rollbackIncomplete)
        throw new Error("Sign out failed and rollback was incomplete.", { cause: error });
      throw error;
    } finally {
      await unlink(storedBackupPath).catch(() => undefined);
      await unlink(liveBackupPath).catch(() => undefined);
      await unlink(stateBackupPath).catch(() => undefined);
    }
  }
}

async function backupIfPresent(sourcePath: string, backupPath: string): Promise<boolean> {
  try {
    await copyFileAtomic(sourcePath, backupPath, { mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function tryRestore(backupPath: string, targetPath: string): Promise<boolean> {
  try {
    await copyFileAtomic(backupPath, targetPath, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

async function removeIfPresent(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}
