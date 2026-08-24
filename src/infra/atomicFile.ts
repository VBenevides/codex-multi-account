import { mkdir, open, rename, rm } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { secureFilePermissions } from "./permissions.js";

export interface AtomicWriteOptions {
  mode?: number;
}

type AtomicData = string | Uint8Array;

async function replaceFile(temporary: string, target: string): Promise<void> {
  try {
    await rename(temporary, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== "win32" || !["EEXIST", "EPERM"].includes(code ?? "")) throw error;
    // ponytail: Windows has no stdlib atomic replace; delete/rename has a brief gap; use native ReplaceFile if needed.
    await rm(target, { force: true });
    await rename(temporary, target);
  }
}

function temporaryPath(targetPath: string): string {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.tmp-${process.pid}-${randomUUID()}`,
  );
}

export async function writeAtomic(
  targetPath: string,
  data: AtomicData,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporary = temporaryPath(targetPath);
  const mode = options.mode ?? 0o600;
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await secureFilePermissions(temporary);
    await replaceFile(temporary, targetPath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function writeJsonAtomic(
  targetPath: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await writeAtomic(targetPath, `${JSON.stringify(value, null, 2)}\n`, options);
}

export async function copyFileAtomic(
  sourcePath: string,
  targetPath: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  await writeAtomic(targetPath, await readFile(sourcePath), options);
}

export async function rollbackFile(targetPath: string, backupPath: string): Promise<void> {
  await copyFileAtomic(backupPath, targetPath);
}

export class AtomicFile {
  static write = writeAtomic;
  static writeJson = writeJsonAtomic;
  static copy = copyFileAtomic;
  static rollback = rollbackFile;
}
