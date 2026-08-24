import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface ProcessResult {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
}

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string, cancel: () => void) => void;
}

export class ProcessRunner {
  run(
    command: string,
    args: readonly string[] = [],
    options: ProcessOptions = {},
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let cancelled = false;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => {
        if (!cancelled) {
          cancelled = true;
          child.kill();
        }
      };
      const onAbort = () => cancel();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          cancel();
        }, options.timeoutMs);
        timer.unref?.();
      }
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
        options.onOutput?.(chunk, cancel);
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
        options.onOutput?.(chunk, cancel);
      });
      child.once("error", (error) => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.once("close", (code, signal) => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        resolve({ code: code ?? -1, signal, stdout, stderr, cancelled, timedOut });
      });
      if (options.input) child.stdin.end(options.input);
      else child.stdin.end();
    });
  }

  async discover(customPath?: string): Promise<string | undefined> {
    if (customPath) {
      try {
        await fs.access(customPath);
        return customPath;
      } catch {
        return undefined;
      }
    }
    const names = os.platform() === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
    for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
      for (const name of names) {
        const candidate = path.join(directory, name);
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          // Keep searching PATH.
        }
      }
    }
    return undefined;
  }
}
