import * as fs from "node:fs/promises";
import { AccountRepository } from "./accountRepository.js";
import type { AuthIdentity } from "./accountIdentity.js";
import { readStateFile, writeStateFile, type AccountStateFile } from "./accountService.js";
import { parseAuthFile, type ParsedAuthFile } from "./authFile.js";
import type { AccountProfile } from "./accountTypes.js";
import { resolvePaths, type CodexPaths } from "../config/paths.js";

export type ReconciliationStatus =
  "selected-match" | "known-profile" | "unmanaged" | "missing-live-auth" | "invalid-live-auth";

export interface ReconciliationProfile {
  id: string;
  name: string;
  slug: string;
}

export interface ReconciliationResult {
  status: ReconciliationStatus;
  selectedProfile: ReconciliationProfile | null;
  matchedProfile: ReconciliationProfile | null;
}

export interface RepairSelectedStateResult {
  repaired: boolean;
  profile: ReconciliationProfile | null;
  reason?: "already-selected" | "unmanaged" | "missing-live-auth" | "invalid-live-auth";
}

export interface ImportCurrentAccountResult {
  imported: boolean;
  profile: ReconciliationProfile | null;
  reason?: "already-known" | "missing-live-auth" | "invalid-live-auth";
}

export interface ReconciliationServiceOptions {
  now?: () => Date;
}

interface Snapshot {
  state: AccountStateFile;
  selectedProfile?: AccountProfile;
  live?: ParsedAuthFile;
  liveStatus?: "missing-live-auth" | "invalid-live-auth";
  matchedProfile?: AccountProfile;
}

export class ReconciliationService {
  private readonly now: () => Date;

  constructor(
    private readonly repository = new AccountRepository(),
    private readonly paths: CodexPaths = repository.paths ?? resolvePaths(),
    options: ReconciliationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async reconcile(): Promise<ReconciliationResult> {
    return this.toResult(await this.snapshot());
  }

  async repairSelectedState(): Promise<RepairSelectedStateResult> {
    const snapshot = await this.snapshot();
    if (!snapshot.matchedProfile || !snapshot.live) {
      return {
        repaired: false,
        profile: null,
        reason: snapshot.liveStatus ?? "unmanaged",
      };
    }

    const profile = summarize(snapshot.matchedProfile);
    if (snapshot.state.selectedProfileId === snapshot.matchedProfile.id) {
      return { repaired: false, profile, reason: "already-selected" };
    }

    await writeStateFile(this.paths.statePath, {
      ...snapshot.state,
      version: 1,
      selectedProfileId: snapshot.matchedProfile.id,
      selectedProfileSlug: snapshot.matchedProfile.slug,
      selectedAt: this.now().toISOString(),
      lastObservedLiveAuthFingerprint: snapshot.live.fingerprint.value,
    });
    return { repaired: true, profile };
  }

  async importCurrentAccount(name: string): Promise<ImportCurrentAccountResult> {
    const snapshot = await this.snapshot();
    if (!snapshot.live) {
      return {
        imported: false,
        profile: null,
        reason: snapshot.liveStatus ?? "invalid-live-auth",
      };
    }
    if (snapshot.matchedProfile) {
      return {
        imported: false,
        profile: summarize(snapshot.matchedProfile),
        reason: "already-known",
      };
    }

    const profile = await this.repository.createProfile(name);
    try {
      await this.repository.writeProfileAuth(profile.id, snapshot.live.bytes);
      await this.repository.updateProfileIdentity(profile.id, snapshot.live.structuredIdentity);
      return { imported: true, profile: summarize(profile) };
    } catch (error) {
      await this.repository.deleteProfile(profile.id).catch(() => undefined);
      throw error;
    }
  }

  private async snapshot(): Promise<Snapshot> {
    const state = await readStateFile(this.paths.statePath);
    const selectedProfile = state.selectedProfileId
      ? await this.repository.getProfile(state.selectedProfileId)
      : undefined;

    let liveBytes: Buffer;
    try {
      liveBytes = await fs.readFile(this.paths.liveAuthPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { state, selectedProfile, liveStatus: "missing-live-auth" };
      }
      return { state, selectedProfile, liveStatus: "invalid-live-auth" };
    }

    let live: ParsedAuthFile;
    try {
      live = parseAuthFile(liveBytes);
    } catch {
      return { state, selectedProfile, liveStatus: "invalid-live-auth" };
    }

    const profiles = await this.repository.listProfiles();
    const exactMatches: AccountProfile[] = [];
    const identityMatches: AccountProfile[] = [];
    for (const profile of profiles) {
      try {
        const stored = parseAuthFile(await this.repository.readProfileAuth(profile.id));
        if (stored.fingerprint.value === live.fingerprint.value) exactMatches.push(profile);
        if (sameKnownIdentity(stored.structuredIdentity, live.structuredIdentity))
          identityMatches.push(profile);
      } catch {
        // A malformed profile cannot safely claim ownership of live auth.
      }
    }

    const exactSelected =
      selectedProfile && exactMatches.some((profile) => profile.id === selectedProfile.id)
        ? selectedProfile
        : undefined;
    const matches = new Map(
      [...exactMatches, ...identityMatches].map((profile) => [profile.id, profile]),
    );
    const matchedProfile =
      exactSelected ?? (matches.size === 1 ? [...matches.values()][0] : undefined);
    return { state, selectedProfile, live, matchedProfile };
  }

  private toResult(snapshot: Snapshot): ReconciliationResult {
    if (snapshot.liveStatus) {
      return {
        status: snapshot.liveStatus,
        selectedProfile: snapshot.selectedProfile ? summarize(snapshot.selectedProfile) : null,
        matchedProfile: null,
      };
    }
    if (!snapshot.matchedProfile) {
      return {
        status: "unmanaged",
        selectedProfile: snapshot.selectedProfile ? summarize(snapshot.selectedProfile) : null,
        matchedProfile: null,
      };
    }
    const selected = snapshot.selectedProfile?.id === snapshot.matchedProfile.id;
    return {
      status: selected ? "selected-match" : "known-profile",
      selectedProfile: snapshot.selectedProfile ? summarize(snapshot.selectedProfile) : null,
      matchedProfile: summarize(snapshot.matchedProfile),
    };
  }
}

function summarize(profile: AccountProfile): ReconciliationProfile {
  return { id: profile.id, name: profile.name, slug: profile.slug };
}

function sameKnownIdentity(left: AuthIdentity, right: AuthIdentity): boolean {
  const keys = ["email", "chatgptUserId", "accountId"] as const;
  const known = keys.filter((key) => left[key] || right[key]);
  return known.length > 0 && known.every((key) => left[key] === right[key]);
}
