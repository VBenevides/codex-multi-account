import * as os from "node:os";
import * as path from "node:path";

export interface CodexPaths {
  codexHome: string;
  liveAuthPath: string;
  configPath: string;
  cmaHome: string;
  accountsHome: string;
  usageDbPath: string;
  statePath: string;
  switchLockPath: string;
}

export interface ProfilePaths {
  directory: string;
  metadataPath: string;
  authPath: string;
}

export const PROFILE_METADATA_FILE = "profile.json";
export const PROFILE_AUTH_FILE = "auth.json";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function assertSafePathSegment(value: string, label = "path segment"): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    CONTROL_CHARACTERS.test(value)
  ) {
    throw new Error(`Unsafe ${label}.`);
  }
}

export function isSafeProfileSlug(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    SAFE_SLUG.test(value) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(value)
  );
}

export function resolveWithin(base: string, ...segments: string[]): string {
  const root = path.resolve(base);
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Resolved path escapes its root.");
  }
  return resolved;
}

export function resolvePaths(home = os.homedir()): CodexPaths {
  if (typeof home !== "string" || home.length === 0 || home.includes("\0")) {
    throw new Error("Invalid home directory.");
  }

  const resolvedHome = path.resolve(home);
  const codexHome = path.join(resolvedHome, ".codex");
  const cmaHome = path.join(codexHome, "cma");

  return {
    codexHome,
    liveAuthPath: path.join(codexHome, "auth.json"),
    configPath: path.join(codexHome, "config.toml"),
    cmaHome,
    accountsHome: path.join(cmaHome, "accounts"),
    usageDbPath: path.join(cmaHome, "usage.sqlite"),
    statePath: path.join(cmaHome, "state.json"),
    switchLockPath: path.join(cmaHome, "switch.lock"),
  };
}

export function resolveProfilePaths(paths: CodexPaths, slug: string): ProfilePaths {
  assertSafePathSegment(slug, "profile slug");
  if (!isSafeProfileSlug(slug)) {
    throw new Error("Unsafe profile slug.");
  }

  const directory = resolveWithin(paths.accountsHome, slug);
  return {
    directory,
    metadataPath: path.join(directory, PROFILE_METADATA_FILE),
    authPath: path.join(directory, PROFILE_AUTH_FILE),
  };
}
