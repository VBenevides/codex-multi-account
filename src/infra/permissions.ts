import { chmod, mkdir, stat } from "node:fs/promises";

export const CMA_DIRECTORY_MODE = 0o700;
export const SECRET_FILE_MODE = 0o600;

export function isUnsupportedPermissionError(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  return code === "ENOTSUP" || code === "EOPNOTSUPP";
}

export async function securePermissions(
  targetPath?: string,
  mode: number = SECRET_FILE_MODE,
): Promise<void> {
  if (!targetPath) return;
  try {
    await chmod(targetPath, mode);
    if (((await stat(targetPath)).mode & 0o777) !== (mode & 0o777))
      throw new Error(`Unable to verify restrictive permissions for ${targetPath}.`);
  } catch (error) {
    if (isUnsupportedPermissionError(error))
      throw new Error(`Filesystem does not support restrictive permissions for ${targetPath}.`, {
        cause: error,
      });
    throw error;
  }
}

export const secureFilePermissions = (targetPath: string) =>
  securePermissions(targetPath, SECRET_FILE_MODE);

export const secureDirectoryPermissions = (targetPath: string) =>
  securePermissions(targetPath, CMA_DIRECTORY_MODE);

export async function ensureSecureDirectory(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true, mode: CMA_DIRECTORY_MODE });
  await secureDirectoryPermissions(targetPath);
}
