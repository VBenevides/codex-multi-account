import { AccountRepository } from "../accounts/accountRepository.js";
import { readStateFile } from "../accounts/accountService.js";
import { parseAuthFile } from "../accounts/authFile.js";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { writeJsonAtomic } from "../infra/atomicFile.js";

const QUOTA_URL = "https://chatgpt.com/backend-api/wham/usage";

export type QuotaRequestPolicy = "disabled" | "selected" | "all";

export interface QuotaServiceOptions {
  policy?: QuotaRequestPolicy;
}

export interface QuotaWindow {
  remainingPercent: number | null;
  resetsAt: string | null;
  windowSeconds: number | null;
}

export interface AccountQuota {
  profileId?: string;
  name: string;
  remainingPercent: number | null;
  resetsAt: string | null;
  lastCheckedAt: string | null;
  windows?: QuotaWindow[];
}

interface QuotaCache {
  version: 1;
  quotas: Array<AccountQuota & { profileId: string }>;
}

export class QuotaService {
  private readonly policy: QuotaRequestPolicy;

  constructor(
    private readonly repository = new AccountRepository(),
    private readonly request: typeof fetch = fetch,
    options: QuotaServiceOptions = {},
  ) {
    this.policy = options.policy ?? "disabled";
  }

  async list(): Promise<AccountQuota[]> {
    const cached = await this.readCache();
    if (this.policy === "disabled") return cached;
    let profiles = await this.repository.listProfiles();
    if (this.policy === "selected") {
      let selectedProfileId: string | null | undefined;
      try {
        selectedProfileId = (await readStateFile(this.repository.paths.statePath))
          .selectedProfileId;
      } catch {
        return cached;
      }
      if (!selectedProfileId) return cached;
      profiles = profiles.filter((profile) => profile.id === selectedProfileId);
    }
    const refreshed = (
      await Promise.all(profiles.map((profile) => this.fetchProfileQuota(profile)))
    ).filter((quota): quota is AccountQuota & { profileId: string } => quota !== undefined);
    if (refreshed.length) {
      const byProfile = new Map(cached.map((quota) => [quota.profileId, quota]));
      for (const quota of refreshed) byProfile.set(quota.profileId, quota);
      await this.writeCache([...byProfile.values()]);
      return [...byProfile.values()];
    }
    return cached;
  }

  async cached(): Promise<AccountQuota[]> {
    return this.readCache();
  }

  async current(): Promise<AccountQuota[]> {
    const profiles = await this.repository.listProfiles();
    return (await Promise.all(profiles.map((profile) => this.fetchProfileQuota(profile)))).filter(
      (quota): quota is AccountQuota & { profileId: string } => quota !== undefined,
    );
  }

  private async fetchProfileQuota(
    profile: Awaited<ReturnType<AccountRepository["getProfile"]>>,
  ): Promise<(AccountQuota & { profileId: string }) | undefined> {
    if (!profile || !(await this.repository.profileAuthExists(profile.id))) return undefined;
    const checkedAt = new Date().toISOString();
    try {
      const auth = parseAuthFile(await this.repository.readProfileAuth(profile.id));
      const token = accessToken(auth.data);
      if (!token) return unavailable(profile.id, profile.name, checkedAt);
      const accountId = auth.structuredIdentity.accountId ?? profile.identity?.accountId;
      const response = await this.request(QUOTA_URL, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return unavailable(profile.id, profile.name, checkedAt);
      return {
        profileId: profile.id,
        name: profile.name,
        ...parseQuotaResponse(await response.json()),
        lastCheckedAt: checkedAt,
      };
    } catch {
      return unavailable(profile.id, profile.name, checkedAt);
    }
  }

  private async readCache(): Promise<Array<AccountQuota & { profileId: string }>> {
    try {
      const value: unknown = JSON.parse(await readFile(this.cachePath(), "utf8"));
      const item = record(value);
      if (!item || item.version !== 1 || !Array.isArray(item.quotas)) return [];
      return item.quotas.filter(isCachedQuota) as Array<AccountQuota & { profileId: string }>;
    } catch {
      return [];
    }
  }

  private async writeCache(quotas: Array<AccountQuota & { profileId: string }>): Promise<void> {
    await writeJsonAtomic(this.cachePath(), { version: 1, quotas } satisfies QuotaCache, {
      mode: 0o600,
    });
  }

  private cachePath(): string {
    return path.join(this.repository.paths.cmaHome, "quota-cache.json");
  }
}

export function parseQuotaResponse(value: unknown): {
  remainingPercent: number | null;
  resetsAt: string | null;
  windows: QuotaWindow[];
} {
  const body = record(value);
  const byLimit = record(body?.rate_limits_by_limit_id);
  const snapshot =
    record(byLimit?.codex) ??
    record(byLimit ? Object.values(byLimit)[0] : undefined) ??
    record(body?.rate_limits) ??
    record(body?.rate_limit);
  const primary = record(snapshot?.primary) ?? record(snapshot?.primary_window);
  const secondary = record(snapshot?.secondary) ?? record(snapshot?.secondary_window);
  const windows = [primary, secondary]
    .filter((window): window is Record<string, unknown> => !!window)
    .map(parseQuotaWindow);
  const window = windows[0];
  if (!window) return { remainingPercent: null, resetsAt: null, windows: [] };
  return {
    remainingPercent: window.remainingPercent,
    resetsAt: window.resetsAt,
    windows,
  };
}

function parseQuotaWindow(window: Record<string, unknown>): QuotaWindow {
  const usedPercent = number(window.used_percent ?? window.usedPercent);
  const reset = number(window.resets_at ?? window.reset_at ?? window.resetsAt);
  const windowMinutes = number(window.window_minutes ?? window.window_duration_mins);
  return {
    remainingPercent: usedPercent === null ? null : 100 - Math.max(0, Math.min(100, usedPercent)),
    resetsAt: reset === null ? null : new Date(reset * 1000).toISOString(),
    windowSeconds:
      number(window.limit_window_seconds ?? window.window_duration_seconds) ??
      (windowMinutes === null ? null : windowMinutes * 60),
  };
}

function accessToken(value: Record<string, unknown>): string | undefined {
  const tokens = record(value.tokens);
  const token = value.access_token ?? tokens?.access_token;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

function unavailable(
  profileId: string,
  name: string,
  lastCheckedAt: string,
): AccountQuota & {
  profileId: string;
} {
  return { profileId, name, remainingPercent: null, resetsAt: null, lastCheckedAt };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isCachedQuota(value: unknown): boolean {
  const item = record(value);
  return Boolean(
    item &&
    typeof item.profileId === "string" &&
    typeof item.name === "string" &&
    (item.remainingPercent === null || typeof item.remainingPercent === "number") &&
    (item.resetsAt === null || typeof item.resetsAt === "string") &&
    (item.lastCheckedAt === null || typeof item.lastCheckedAt === "string") &&
    (!("windows" in item) ||
      (Array.isArray(item.windows) && item.windows.every(isCachedQuotaWindow))),
  );
}

function isCachedQuotaWindow(value: unknown): boolean {
  const item = record(value);
  return Boolean(
    item &&
    (item.remainingPercent === null || typeof item.remainingPercent === "number") &&
    (item.resetsAt === null || typeof item.resetsAt === "string") &&
    (item.windowSeconds === null || typeof item.windowSeconds === "number"),
  );
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
