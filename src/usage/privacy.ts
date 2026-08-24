import * as os from "node:os";
import * as path from "node:path";

export type WorkingDirectoryDisplay = "full" | "homeRelative" | "basename";

export function formatWorkingDirectory(
  value: string,
  display: WorkingDirectoryDisplay = "full",
  home = os.homedir(),
): string {
  if (!value || value === "Unknown" || display === "full") return value;
  if (display === "basename") return path.basename(value) || value;
  const relative = path.relative(home, value);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? `~${path.sep}${relative}`
    : value === home
      ? "~"
      : value;
}
