import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { AccountRepository } from "./accountRepository.js";
import { parseAuthFile } from "./authFile.js";
import { ProcessRunner } from "../infra/process.js";
import { resolvePaths, type CodexPaths } from "../config/paths.js";

const LOGIN_STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LOGIN_HOSTS = new Set(["auth.openai.com", "chatgpt.com"]);
const activeStaging = new Set<string>();

export interface SignInOptions {
  binaryPath?: string;
  args?: readonly string[];
  timeoutMs?: number;
  onLoginUrl?: (url: string, cancel: () => void) => void;
}

export function extractLoginUrl(output: string): string | undefined {
  const cleanOutput = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const match of cleanOutput.matchAll(/https?:\/\/[^\s"'<>]+/giu)) {
    const candidate = match[0].replace(/[),.;]+$/, "");
    try {
      const url = new URL(candidate);
      if (
        url.protocol === "https:" &&
        LOGIN_HOSTS.has(url.hostname) &&
        !url.port &&
        !url.username &&
        !url.password
      )
        return candidate;
    } catch {
      // Ignore malformed URLs and continue searching CLI output.
    }
  }
  return undefined;
}

export async function cleanupLoginStaging(
  paths: CodexPaths,
  now = Date.now(),
  maxAgeMs = LOGIN_STAGING_MAX_AGE_MS,
  protectedPaths: ReadonlySet<string> = activeStaging,
): Promise<void> {
  const root = path.join(paths.cmaHome, "login-staging");
  let rootEntry;
  try {
    rootEntry = await fs.lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    return;
  }
  if (rootEntry.isSymbolicLink()) throw new Error("Invalid login staging directory.");
  if (!rootEntry.isDirectory()) return;

  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory()) return;
      const candidate = path.join(root, entry.name);
      if (protectedPaths.has(candidate)) return;
      try {
        const stats = await fs.lstat(candidate);
        if (stats.isSymbolicLink() || !stats.isDirectory() || now - stats.mtimeMs < maxAgeMs)
          return;
        await fs.rm(candidate, { recursive: true, force: true });
      } catch {
        // Cleanup is best effort; a live login must not be interrupted.
      }
    }),
  );
}

export class SignInService {
  constructor(
    private readonly repository = new AccountRepository(),
    private readonly paths: CodexPaths = repository.paths ?? resolvePaths(),
    private readonly process = new ProcessRunner(),
  ) {}

  async signIn(profileId: string, options: SignInOptions = {}): Promise<void> {
    const binary = await this.process.discover(options.binaryPath);
    if (!binary) throw new Error("Codex CLI was not found. Configure a custom binary path.");
    const staging = path.join(this.paths.cmaHome, "login-staging", randomUUID());
    activeStaging.add(staging);
    let loginOutput = "";
    let loginUrlShown = false;
    try {
      await cleanupLoginStaging(this.paths);
      await fs.mkdir(staging, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        path.join(staging, "config.toml"),
        'cli_auth_credentials_store = "file"\n',
        { mode: 0o600 },
      );
      const result = await this.process.run(binary, options.args ?? ["login"], {
        cwd: staging,
        env: { CODEX_HOME: staging },
        timeoutMs: options.timeoutMs ?? 5 * 60_000,
        onOutput: (chunk, cancel) => {
          if (!options.onLoginUrl || loginUrlShown) return;
          loginOutput += chunk;
          const url = extractLoginUrl(loginOutput);
          if (url) {
            loginUrlShown = true;
            options.onLoginUrl(url, cancel);
          }
        },
      });
      if (result.timedOut) throw new Error("Codex login timed out.");
      if (result.cancelled) return;
      if (result.code !== 0) throw new Error(`Codex login failed with exit code ${result.code}.`);
      const authPath = path.join(staging, "auth.json");
      const auth = parseAuthFile(await fs.readFile(authPath));
      await this.repository.writeProfileAuth(profileId, auth.bytes);
      await this.repository.updateProfileIdentity(profileId, auth.structuredIdentity);
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
      activeStaging.delete(staging);
    }
  }
}
