import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { resolvePaths } from "./paths.js";

export type AuthStorageMode = "file" | "keyring" | "auto" | "unknown" | "missing";

export interface CodexConfigInspection {
  exists: boolean;
  configuredMode: AuthStorageMode;
  effectiveMode: AuthStorageMode;
  mode: AuthStorageMode;
  isFileBackedAuthReady: boolean;
}

export interface ConfigUpdateResult extends CodexConfigInspection {
  changed: boolean;
  backupPath?: string;
}

export interface CodexConfigServiceOptions {
  configPath?: string;
  backupPath?: string;
}

export class CodexConfigService {
  private readonly configPath: string;
  private readonly backupPath: string;

  public constructor(options: CodexConfigServiceOptions | string = {}) {
    const paths = resolvePaths();
    const normalized = typeof options === "string" ? { configPath: options } : options;
    this.configPath = normalized.configPath ?? paths.configPath;
    this.backupPath = normalized.backupPath ?? `${this.configPath}.cma-backup`;
  }

  public async inspect(): Promise<CodexConfigInspection> {
    let contents: string;
    try {
      contents = await fs.readFile(this.configPath, "utf8");
    } catch (error) {
      if (isNotFound(error)) return inspection(false, "missing");
      throw error;
    }
    const configuredMode = parseMode(contents);
    const effectiveMode = configuredMode === "missing" ? "auto" : configuredMode;
    return inspection(true, configuredMode, effectiveMode);
  }

  public isFileBackedAuthReady(): Promise<boolean> {
    return this.inspect().then((result) => result.isFileBackedAuthReady);
  }

  public enableFileBackedAuth(): Promise<ConfigUpdateResult> {
    return this.setAuthStorageMode("file");
  }

  public updateFileBackedAuth(): Promise<ConfigUpdateResult> {
    return this.enableFileBackedAuth();
  }

  public async setAuthStorageMode(mode: "file"): Promise<ConfigUpdateResult> {
    const before = await this.inspect();
    if (before.configuredMode === mode) return { ...before, changed: false };

    let original: Buffer | undefined;
    try {
      original = await fs.readFile(this.configPath);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    await fs.mkdir(path.dirname(this.configPath), { recursive: true, mode: 0o700 });
    if (original) await fs.copyFile(this.configPath, this.backupPath);
    try {
      const text = original?.toString("utf8") ?? "";
      const updated = replaceRootSetting(text, "file");
      await atomicWrite(
        this.configPath,
        updated,
        original ? await fileMode(this.configPath) : 0o600,
      );
      const after = await this.inspect();
      if (!after.isFileBackedAuthReady) throw new Error("Codex config verification failed");
      return { ...after, changed: true, backupPath: original ? this.backupPath : undefined };
    } catch (error) {
      if (original) {
        await atomicWrite(this.configPath, original, await fileMode(this.backupPath));
      } else {
        await fs.unlink(this.configPath).catch(() => undefined);
      }
      throw error instanceof Error && error.message === "Codex config verification failed"
        ? error
        : new Error("Unable to update Codex config safely");
    }
  }
}

function inspection(
  exists: boolean,
  configuredMode: AuthStorageMode,
  effectiveMode: AuthStorageMode = configuredMode,
): CodexConfigInspection {
  return {
    exists,
    configuredMode,
    effectiveMode,
    mode: effectiveMode,
    isFileBackedAuthReady: effectiveMode === "file",
  };
}

function parseMode(contents: string): AuthStorageMode {
  let inRoot = true;
  let found: AuthStorageMode = "missing";
  for (const line of contents.split(/\r?\n/u)) {
    const section = line.match(/^\s*\[([^\]]+)\]/u);
    if (section) {
      inRoot = section[1].trim() === "";
      continue;
    }
    if (!inRoot) continue;
    const match = line.match(
      /^\s*cli_auth_credentials_store\s*=\s*(["'])(.*?)\1(?:\s*(?:#.*)?)?\s*$/u,
    );
    if (!match) continue;
    switch (match[2].trim().toLocaleLowerCase()) {
      case "file":
        found = "file";
        break;
      case "keyring":
        found = "keyring";
        break;
      case "auto":
        found = "auto";
        break;
      default:
        found = "unknown";
    }
  }
  return found;
}

function replaceRootSetting(contents: string, value: string): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = contents.endsWith("\n") || contents.endsWith("\r");
  const lines = contents.replace(/\r?\n$/u, "").split(/\r?\n/u);
  let inRoot = true;
  let replaced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const section = line.match(/^\s*\[([^\]]+)\]/u);
    if (section) {
      inRoot = section[1].trim() === "";
      continue;
    }
    if (inRoot && /^\s*cli_auth_credentials_store\s*=\s*/u.test(line) && !/^\s*#/u.test(line)) {
      const match = line.match(
        /^(\s*cli_auth_credentials_store\s*=\s*)(["'])(.*?)(\2)(\s*(?:#.*)?)$/u,
      );
      lines[index] = match
        ? `${match[1]}"${value}"${match[5]}`
        : `cli_auth_credentials_store = "${value}"`;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    const sectionIndex = lines.findIndex((line) => /^\s*\[[^\]]+\]/u.test(line));
    lines.splice(
      sectionIndex < 0 ? lines.length : sectionIndex,
      0,
      `cli_auth_credentials_store = "${value}"`,
    );
  }
  const result = lines.join(newline);
  return hadFinalNewline || !contents ? `${result}${newline}` : result;
}

async function atomicWrite(
  filePath: string,
  contents: string | Buffer,
  mode: number,
): Promise<void> {
  const tempPath = `${filePath}.cma-${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(tempPath, "wx", mode);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.chmod(tempPath, mode).catch(() => undefined);
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

async function fileMode(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).mode & 0o777;
  } catch {
    return 0o600;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
