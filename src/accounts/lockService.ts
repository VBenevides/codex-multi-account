import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const ORPHAN_GRACE_MS = 1_000;

export interface LockInfo {
  pid: number;
  host: string;
  createdAt: string;
  token?: string;
}

export interface LockHandle {
  readonly info: LockInfo;
  release(): Promise<void>;
}

export interface LockServiceOptions {
  lockPath: string;
  staleAfterMs?: number;
  now?: () => number;
  host?: string;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
}

export class LockService {
  private readonly lockPath: string;
  private readonly staleAfterMs: number;
  private readonly now: () => number;
  private readonly host: string;
  private readonly pid: number;
  private readonly isProcessAlive: (pid: number) => boolean;

  public constructor(options: LockServiceOptions | string) {
    const normalized = typeof options === "string" ? { lockPath: options } : options;
    this.lockPath = normalized.lockPath;
    this.staleAfterMs = normalized.staleAfterMs ?? 15 * 60_000;
    this.now = normalized.now ?? Date.now;
    this.host = normalized.host ?? os.hostname();
    this.pid = normalized.pid ?? process.pid;
    this.isProcessAlive = normalized.isProcessAlive ?? processAlive;
  }

  public async acquire(): Promise<LockHandle> {
    await fs.mkdir(path.dirname(this.lockPath), { recursive: true, mode: 0o700 });
    for (;;) {
      const info: LockInfo = {
        pid: this.pid,
        host: this.host,
        createdAt: new Date(this.now()).toISOString(),
        token: crypto.randomUUID(),
      };
      const candidatePath = `${this.lockPath}.candidate-${info.token}`;
      try {
        await fs.mkdir(candidatePath, 0o700);
        const handle = await fs.open(path.join(candidatePath, "owner.json"), "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(info));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(candidatePath, this.lockPath);
        return {
          info,
          release: () => this.release(info),
        };
      } catch (error) {
        await fs.rm(candidatePath, { recursive: true, force: true }).catch(() => undefined);
        if (!isAlreadyExists(error)) throw error;
        if (!(await this.clearStale()))
          throw new Error("CMA account switch is already in progress");
      }
    }
  }

  public async withLock<T>(operation: () => Promise<T> | T): Promise<T> {
    const lock = await this.acquire();
    try {
      return await operation();
    } finally {
      await lock.release();
    }
  }

  public async readInfo(): Promise<LockInfo | undefined> {
    try {
      let contents: string;
      try {
        contents = await fs.readFile(path.join(this.lockPath, "owner.json"), "utf8");
      } catch (error) {
        if (isNotDirectory(error)) contents = await fs.readFile(this.lockPath, "utf8");
        else throw error;
      }
      const parsed: unknown = JSON.parse(contents);
      if (!isLockInfo(parsed)) return undefined;
      return parsed;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      return undefined;
    }
  }

  public async isStale(): Promise<boolean> {
    const info = await this.readInfo();
    if (!info) return this.isOrphaned();
    const createdAt = Date.parse(info.createdAt);
    if (!Number.isFinite(createdAt) || this.now() - createdAt < this.staleAfterMs) return false;
    if (info.host === this.host) return !this.isProcessAlive(info.pid);
    return true;
  }

  public async clearStale(): Promise<boolean> {
    const info = await this.readInfo();
    if (!(await this.isStale())) return false;
    if (!info) {
      const quarantine = `${this.lockPath}.stale-${crypto.randomUUID()}`;
      try {
        await fs.rename(this.lockPath, quarantine);
        await fs.rm(quarantine, { recursive: true, force: true });
        return true;
      } catch (error) {
        return isNotFound(error) ? true : false;
      }
    }
    try {
      const current = await this.readInfo();
      if (!current || current.token !== info.token) return false;
      const quarantine = `${this.lockPath}.stale-${crypto.randomUUID()}`;
      await fs.rename(this.lockPath, quarantine);
      await fs.rm(quarantine, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (isNotFound(error)) return true;
      return false;
    }
  }

  private async release(info: LockInfo): Promise<void> {
    try {
      const current = await this.readInfo();
      if (current?.token !== info.token) return;
      const quarantine = `${this.lockPath}.released-${crypto.randomUUID()}`;
      await fs.rename(this.lockPath, quarantine);
      await fs.rm(quarantine, { recursive: true, force: true });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  private async isOrphaned(): Promise<boolean> {
    try {
      const [entries, stats] = await Promise.all([
        fs.readdir(this.lockPath),
        fs.stat(this.lockPath),
      ]);
      return entries.length === 0 && this.now() - stats.mtimeMs >= ORPHAN_GRACE_MS;
    } catch {
      return false;
    }
  }
}

function isLockInfo(value: unknown): value is LockInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const info = value as Partial<LockInfo>;
  return (
    Number.isInteger(info.pid) &&
    (info.pid ?? 0) > 0 &&
    typeof info.host === "string" &&
    typeof info.createdAt === "string"
  );
}

function processAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY"),
  );
}

function isNotDirectory(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOTDIR");
}
