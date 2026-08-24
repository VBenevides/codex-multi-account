import { randomUUID } from "node:crypto";

export const ACCOUNT_PROFILE_VERSION = 1 as const;
export const MAX_ACCOUNT_NAME_LENGTH = 100;
export const MAX_PROFILE_SLUG_LENGTH = 64;

export interface AccountIdentityMetadata {
  email?: string | null;
  chatgptUserId?: string | null;
  accountId?: string | null;
}

export interface AccountProfile {
  version: typeof ACCOUNT_PROFILE_VERSION;
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  identity?: AccountIdentityMetadata;
}

export interface AccountState {
  profile: AccountProfile;
  signedIn: boolean;
  selected: boolean;
  liveAuthMatches: boolean;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function normalizeAccountName(name: string): string {
  if (typeof name !== "string") throw new Error("Account name must be text.");
  const normalized = name.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_ACCOUNT_NAME_LENGTH ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    CONTROL_CHARACTERS.test(normalized) ||
    WINDOWS_RESERVED_NAME.test(normalized) ||
    /[. ]$/u.test(normalized)
  ) {
    throw new Error("Invalid account name.");
  }
  return normalized;
}

export function validateAccountName(name: string): void {
  normalizeAccountName(name);
}

export function isValidAccountName(name: unknown): name is string {
  try {
    normalizeAccountName(name as string);
    return true;
  } catch {
    return false;
  }
}

export function slugifyProfileName(name: string): string {
  const normalized = normalizeAccountName(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return (normalized || "profile").slice(0, MAX_PROFILE_SLUG_LENGTH).replace(/-+$/u, "");
}

export function isValidProfileSlug(slug: unknown): slug is string {
  return (
    typeof slug === "string" &&
    slug.length > 0 &&
    slug.length <= MAX_PROFILE_SLUG_LENGTH &&
    SLUG_PATTERN.test(slug) &&
    !WINDOWS_RESERVED_NAME.test(slug)
  );
}

export function validateProfileSlug(slug: string): void {
  if (!isValidProfileSlug(slug)) throw new Error("Invalid profile slug.");
}

export function uniqueProfileSlug(name: string, existingSlugs: Iterable<string>): string {
  const used = new Set(existingSlugs);
  const base = slugifyProfileName(name);
  if (!used.has(base)) return base;

  for (let suffix = 2; ; suffix += 1) {
    const ending = `-${suffix}`;
    const candidate = `${base.slice(0, MAX_PROFILE_SLUG_LENGTH - ending.length)}${ending}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function createAccountProfile(
  name: string,
  options: { slug?: string; id?: string; now?: Date } = {},
): AccountProfile {
  const safeName = normalizeAccountName(name);
  const slug = options.slug ?? slugifyProfileName(safeName);
  validateProfileSlug(slug);
  const timestamp = (options.now ?? new Date()).toISOString();

  return {
    version: ACCOUNT_PROFILE_VERSION,
    id: options.id ?? randomUUID(),
    name: safeName,
    slug,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAccountProfile(value: unknown): value is AccountProfile {
  try {
    parseAccountProfile(value);
    return true;
  } catch {
    return false;
  }
}

export function parseAccountProfile(value: unknown, expectedSlug?: string): AccountProfile {
  if (!isRecord(value) || value.version !== ACCOUNT_PROFILE_VERSION) {
    throw new Error("Invalid profile metadata.");
  }

  const profile = value as Partial<AccountProfile>;
  if (
    typeof profile.id !== "string" ||
    profile.id.length === 0 ||
    typeof profile.name !== "string" ||
    typeof profile.slug !== "string" ||
    typeof profile.createdAt !== "string" ||
    Number.isNaN(Date.parse(profile.createdAt)) ||
    typeof profile.updatedAt !== "string" ||
    Number.isNaN(Date.parse(profile.updatedAt))
  ) {
    throw new Error("Invalid profile metadata.");
  }

  normalizeAccountName(profile.name);
  validateProfileSlug(profile.slug);
  if (expectedSlug !== undefined && profile.slug !== expectedSlug) {
    throw new Error("Profile slug does not match its directory.");
  }

  if (profile.identity !== undefined) {
    if (!isRecord(profile.identity)) throw new Error("Invalid profile identity metadata.");
    for (const key of ["email", "chatgptUserId", "accountId"] as const) {
      const item = profile.identity[key];
      if (item !== undefined && item !== null && typeof item !== "string") {
        throw new Error("Invalid profile identity metadata.");
      }
    }
  }

  return {
    version: ACCOUNT_PROFILE_VERSION,
    id: profile.id,
    name: profile.name,
    slug: profile.slug,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    ...(profile.identity ? { identity: profile.identity } : {}),
  };
}
