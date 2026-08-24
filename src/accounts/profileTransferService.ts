import { AccountRepository } from "./accountRepository.js";
import { parseAccountProfile, validateProfileSlug, type AccountProfile } from "./accountTypes.js";

export const PROFILE_TRANSFER_FORMAT = "cma-profile-metadata" as const;
export const PROFILE_TRANSFER_VERSION = 1 as const;

export interface ProfileTransferDocument {
  format: typeof PROFILE_TRANSFER_FORMAT;
  version: typeof PROFILE_TRANSFER_VERSION;
  profile: AccountProfile;
}

export class ProfileTransferService {
  constructor(private readonly repository: AccountRepository) {}

  async exportMetadata(profileId: string): Promise<string> {
    const profile = await this.repository.getProfile(profileId);
    if (!profile) throw new Error("Profile not found.");
    return `${JSON.stringify(
      { format: PROFILE_TRANSFER_FORMAT, version: PROFILE_TRANSFER_VERSION, profile },
      null,
      2,
    )}\n`;
  }

  async importMetadata(input: string | unknown): Promise<AccountProfile> {
    const source = parseTransferDocument(input);
    const created = await this.repository.createProfile(source.name);
    try {
      return source.identity
        ? await this.repository.updateProfileIdentity(created.id, source.identity)
        : created;
    } catch (error) {
      await this.repository.deleteProfile(created.id).catch(() => undefined);
      throw error;
    }
  }
}

function parseTransferDocument(input: string | unknown): AccountProfile {
  let value: unknown;
  try {
    value = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("Invalid profile transfer data.");
  }

  if (!isRecord(value)) throw new Error("Invalid profile transfer data.");
  if (value.format !== PROFILE_TRANSFER_FORMAT || value.version !== PROFILE_TRANSFER_VERSION) {
    throw new Error("Invalid profile transfer data.");
  }

  const profile = parseAccountProfile(value.profile);
  validateProfileSlug(profile.slug);
  return profile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
