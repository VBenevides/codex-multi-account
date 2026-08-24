import { watch, FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";

export interface RolloutWatcherOptions {
  root?: string;
  roots?: readonly string[];
  intervalMs?: number;
  debounceMs?: number;
  onFile: (filePath: string) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export class RolloutWatcher {
  private readonly roots: readonly string[];
  private readonly intervalMs: number;
  private readonly debounceMs: number;
  private readonly onFile: RolloutWatcherOptions["onFile"];
  private readonly onError: (error: unknown) => void;
  private readonly watchers: FSWatcher[] = [];
  private readonly knownFiles = new Map<string, string>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private interval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(options: RolloutWatcherOptions) {
    this.roots = options.roots ?? (options.root ? [options.root] : []);
    this.intervalMs = options.intervalMs ?? 15_000;
    this.debounceMs = options.debounceMs ?? 50;
    this.onFile = options.onFile;
    this.onError = options.onError ?? (() => undefined);
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    for (const root of this.roots) {
      try {
        this.watchers.push(
          watch(root, { recursive: true }, (_event, filename) => {
            if (!filename) {
              void this.reconcile();
              return;
            }
            const filePath = path.join(root, filename.toString());
            if (isRollout(filePath)) this.schedule(filePath);
            else void this.reconcile();
          }),
        );
      } catch {
        // Reconciliation still handles hosts without recursive fs.watch support.
      }
    }
    await this.reconcile();
    this.interval = setInterval(() => void this.reconcile(), this.intervalMs);
    this.interval.unref?.();
  }

  async reconcile(): Promise<void> {
    if (!this.running) return;
    try {
      const current = new Map<string, string>();
      for (const root of this.roots) {
        for (const filePath of await findRollouts(root)) {
          try {
            const value = await stat(filePath);
            const signature = `${value.size}:${value.mtimeMs}:${value.ino ?? "?"}`;
            current.set(filePath, signature);
            if (this.knownFiles.get(filePath) !== signature) this.schedule(filePath);
          } catch {
            // A rollout can disappear between directory enumeration and stat.
          }
        }
      }
      this.knownFiles.clear();
      for (const [filePath, signature] of current) this.knownFiles.set(filePath, signature);
    } catch (error) {
      this.onError(error);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    for (const watcher of this.watchers.splice(0)) watcher.close();
  }

  dispose = this.stop.bind(this);

  private schedule(filePath: string): void {
    if (!this.running || this.pending.has(filePath)) return;
    const timer = setTimeout(() => {
      this.pending.delete(filePath);
      if (!this.running) return;
      Promise.resolve(this.onFile(filePath)).catch(this.onError);
    }, this.debounceMs);
    timer.unref?.();
    this.pending.set(filePath, timer);
  }
}

function isRollout(filePath: string): boolean {
  return path.basename(filePath).startsWith("rollout-") && filePath.endsWith(".jsonl");
}

export async function findRollouts(root: string): Promise<string[]> {
  const result: string[] = [];
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(filePath);
      else if (entry.isFile() && isRollout(filePath)) result.push(filePath);
    }
  }
  return result;
}
