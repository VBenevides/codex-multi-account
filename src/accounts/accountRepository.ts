import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { resolvePaths, resolveProfilePaths, type CodexPaths } from "../config/paths.js";
import { writeAtomic, writeJsonAtomic } from "../infra/atomicFile.js";
import { ensureSecureDirectory, secureDirectoryPermissions } from "../infra/permissions.js";
import {
  createAccountProfile,
  normalizeAccountName,
  parseAccountProfile,
  uniqueProfileSlug,
  type AccountProfile,
} from "./accountTypes.js";
import { parseAuthFile } from "./authFile.js";

function isNotFound(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "ENOENT";
}

export class AccountRepository {
  readonly paths: CodexPaths;

  constructor(paths: CodexPaths = resolvePaths()) {
    this.paths = paths;
  }

  private async directoryNames(): Promise<string[]> {
    try {
      const entries = await readdir(this.paths.accountsHome, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  private async readProfile(slug: string): Promise<AccountProfile | undefined> {
    const profilePaths = resolveProfilePaths(this.paths, slug);
    try {
      const directory = await lstat(profilePaths.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) return undefined;
      const value = JSON.parse(await readFile(profilePaths.metadataPath, "utf8"));
      let profile: AccountProfile;
      try {
        profile = parseAccountProfile(value);
      } catch {
        return undefined;
      }

      if (profile.slug !== slug) {
        profile = { ...profile, slug };
        await writeJsonAtomic(profilePaths.metadataPath, profile, { mode: 0o600 });
      }
      return profile;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      if (error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  async listProfiles(): Promise<AccountProfile[]> {
    const profiles = await Promise.all(
      (await this.directoryNames()).map((slug) => this.readProfile(slug)),
    );
    return profiles
      .filter((profile): profile is AccountProfile => profile !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async reconcileProfiles(): Promise<AccountProfile[]> {
    return this.listProfiles();
  }

  async getProfile(id: string): Promise<AccountProfile | undefined> {
    return (await this.listProfiles()).find((profile) => profile.id === id);
  }

  async getProfileBySlug(slug: string): Promise<AccountProfile | undefined> {
    try {
      return await this.readProfile(slug);
    } catch {
      return undefined;
    }
  }

  async createProfile(name: string): Promise<AccountProfile> {
    const normalizedName = normalizeAccountName(name);
    await ensureSecureDirectory(this.paths.accountsHome);
    const directoryNames = new Set(await this.directoryNames());
    let slug = uniqueProfileSlug(normalizedName, directoryNames);
    let directory: string;

    for (;;) {
      directory = resolveProfilePaths(this.paths, slug).directory;
      try {
        await mkdir(directory, { mode: 0o700 });
        break;
      } catch (error) {
        if ((error as { code?: string } | undefined)?.code !== "EEXIST") throw error;
        directoryNames.add(slug);
        slug = uniqueProfileSlug(normalizedName, directoryNames);
      }
    }

    await secureDirectoryPermissions(directory);
    const profile = createAccountProfile(normalizedName, { slug });
    try {
      await writeJsonAtomic(resolveProfilePaths(this.paths, slug).metadataPath, profile, {
        mode: 0o600,
      });
      return profile;
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async renameProfile(id: string, newName: string): Promise<AccountProfile> {
    const profile = await this.getProfile(id);
    if (!profile) throw new Error("Profile not found.");
    const normalizedName = normalizeAccountName(newName);
    const names = new Set((await this.directoryNames()).filter((name) => name !== profile.slug));
    const slug = uniqueProfileSlug(normalizedName, names);
    const current = resolveProfilePaths(this.paths, profile.slug);
    const next = resolveProfilePaths(this.paths, slug);
    const updated = { ...profile, name: normalizedName, slug, updatedAt: new Date().toISOString() };

    if (slug !== profile.slug) {
      try {
        await lstat(next.directory);
        throw new Error("Profile slug already exists.");
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      await rename(current.directory, next.directory);
      try {
        await writeJsonAtomic(next.metadataPath, updated, { mode: 0o600 });
      } catch (error) {
        await rename(next.directory, current.directory).catch(() => undefined);
        throw error;
      }
    } else {
      await writeJsonAtomic(current.metadataPath, updated, { mode: 0o600 });
    }
    return updated;
  }

  async deleteProfile(id: string): Promise<void> {
    const profile = await this.getProfile(id);
    if (!profile) throw new Error("Profile not found.");
    const directory = resolveProfilePaths(this.paths, profile.slug).directory;
    const entry = await lstat(directory);
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error("Invalid profile directory.");
    await rm(directory, { recursive: true, force: false });
  }

  async profileAuthExists(id: string): Promise<boolean> {
    const profile = await this.getProfile(id);
    if (!profile) return false;
    try {
      const entry = await lstat(resolveProfilePaths(this.paths, profile.slug).authPath);
      return entry.isFile() && !entry.isSymbolicLink();
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async readProfileAuth(id: string): Promise<Uint8Array> {
    const profile = await this.getProfile(id);
    if (!profile) throw new Error("Profile not found.");
    return readRegularFile(resolveProfilePaths(this.paths, profile.slug).authPath);
  }

  async writeProfileAuth(id: string, bytes: Uint8Array): Promise<void> {
    const profile = await this.getProfile(id);
    if (!profile) throw new Error("Profile not found.");
    const parsed = parseAuthFile(bytes);
    const authPath = resolveProfilePaths(this.paths, profile.slug).authPath;
    await writeAtomic(authPath, parsed.bytes, { mode: 0o600 });
  }

  async updateProfileIdentity(
    id: string,
    identity: NonNullable<AccountProfile["identity"]>,
  ): Promise<AccountProfile> {
    const profile = await this.getProfile(id);
    if (!profile) throw new Error("Profile not found.");
    const nextIdentity = { ...profile.identity };
    for (const key of ["email", "chatgptUserId", "accountId"] as const) {
      if (identity[key] !== undefined) nextIdentity[key] = identity[key];
    }
    const updated = {
      ...profile,
      identity: nextIdentity,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(resolveProfilePaths(this.paths, profile.slug).metadataPath, updated, {
      mode: 0o600,
    });
    return updated;
  }

  async deleteProfileAuth(id: string): Promise<void> {
    const profile = await this.getProfile(id);
    if (!profile) throw new Error("Profile not found.");
    await rm(resolveProfilePaths(this.paths, profile.slug).authPath, { force: true });
  }

  async copyProfileAuthTo(id: string, targetPath: string): Promise<void> {
    const profile = await this.getProfile(id);
    if (!profile) throw new Error("Profile not found.");
    await writeAtomic(
      targetPath,
      await readRegularFile(resolveProfilePaths(this.paths, profile.slug).authPath),
    );
  }
}

async function readRegularFile(filePath: string): Promise<Uint8Array> {
  const entry = await lstat(filePath);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("Invalid profile auth file.");
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
