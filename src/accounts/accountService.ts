import { readFile } from "node:fs/promises";
import type { AccountProfile } from "./accountTypes.js";
import { AccountRepository } from "./accountRepository.js";
import { writeJsonAtomic } from "../infra/atomicFile.js";

export interface AccountStateFile {
  version: number;
  selectedProfileId?: string | null;
  selectedProfileSlug?: string | null;
  selectedAt?: string | null;
  lastObservedLiveAuthFingerprint?: string | null;
}

export async function readStateFile(statePath: string): Promise<AccountStateFile> {
  try {
    const value: unknown = JSON.parse(await readFile(statePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid CMA state.");
    const state = value as Partial<Omit<AccountStateFile, "version">>;
    return { version: 1, ...state };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 };
    if (error instanceof SyntaxError) throw new Error("Invalid CMA state JSON.");
    throw error;
  }
}

export function writeStateFile(statePath: string, state: AccountStateFile): Promise<void> {
  return writeJsonAtomic(statePath, { ...state, version: 1 }, { mode: 0o600 });
}

export function validateAccountName(name: string): string {
  return name.trim();
}

export function slugifyAccountName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export class AccountService extends AccountRepository {
  createAccount(name: string): Promise<AccountProfile> {
    return this.createProfile(name);
  }
}
