import type { SqliteDatabase } from "./database.js";
import type { AccountInterval } from "./attributionService.js";
import type { RolloutCursor } from "./rolloutTailer.js";
import type { TailedTokenEvent } from "./rolloutTailer.js";

export interface UsageFilter {
  profileId?: string;
  accountAddress?: string;
  model?: string;
  workingDirectory?: string;
  from?: string;
  until?: string;
}

export interface UsageTotals {
  inputTokens: bigint;
  cachedInputTokens: bigint;
  outputTokens: bigint;
  uncachedInputTokens?: bigint;
  interactions?: number;
}

export interface UsageAccount {
  profileId: string;
  name: string;
  selected?: boolean;
}

export interface UsageBreakdown {
  accountName: string;
  workingDirectory: string;
  model: string;
  inputTokens: bigint;
  cachedInputTokens: bigint;
  outputTokens: bigint;
  uncachedInputTokens?: bigint;
  totalTokens?: bigint;
  interactions?: number;
}

export interface UsageFilterOptions {
  models: string[];
  workingDirectories: string[];
}

export interface UsageDaily {
  date: string;
  model: string;
  inputTokens: bigint;
  cachedInputTokens?: bigint;
  uncachedInputTokens?: bigint;
  outputTokens: bigint;
  interactions: number;
  dimension?: string;
  workingDirectory?: string;
  accountName?: string;
}

export type UsageDailyGranularity = "hour" | "day" | "week" | "month";
export type UsageDailyGroupBy = "model" | "project" | "account";

export interface UsageDailyOptions {
  granularity?: UsageDailyGranularity;
  groupBy?: UsageDailyGroupBy;
}

export interface UnattributedUsageRange {
  date: string;
  events: number;
}

interface UsageInsert {
  profileId?: string | null;
  accountAddress?: string | null;
  rolloutPath: string;
  event: TailedTokenEvent;
  workingDirectory?: string;
  model?: string;
}

export class UsageRepository {
  constructor(private readonly database: SqliteDatabase) {}

  upsertProfile(profile: {
    id: string;
    name: string;
    slug: string;
    email?: string | null;
    chatgptUserId?: string | null;
    accountId?: string | null;
    createdAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO profiles(id, name, slug, account_address, chatgpt_user_id, account_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, slug=excluded.slug,
           account_address=excluded.account_address, chatgpt_user_id=excluded.chatgpt_user_id,
           account_id=excluded.account_id`,
      )
      .run(
        profile.id,
        profile.name,
        profile.slug,
        profile.email ?? null,
        profile.chatgptUserId ?? null,
        profile.accountId ?? null,
        profile.createdAt,
      );
  }

  softDeleteProfile(id: string): void {
    this.database
      .prepare("UPDATE profiles SET deleted_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  startInterval(
    profileId: string | null,
    accountAddress: string | null,
    at: string,
    reason = "switch",
  ): void {
    this.database.exec("BEGIN");
    try {
      this.database
        .prepare("UPDATE account_switches SET active_until = ? WHERE active_until IS NULL")
        .run(at);
      this.database
        .prepare(
          "INSERT INTO account_switches(profile_id, account_address, active_from, reason) VALUES (?, ?, ?, ?)",
        )
        .run(profileId, accountAddress, at, reason);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  closeInterval(profileId: string, at: string): void {
    this.database
      .prepare(
        "UPDATE account_switches SET active_until = ? WHERE profile_id = ? AND active_until IS NULL",
      )
      .run(at, profileId);
  }

  listIntervals(): AccountInterval[] {
    const rows = this.database
      .prepare(
        `SELECT profile_id, account_address, active_from, active_until
         FROM account_switches
         ORDER BY active_from, id`,
      )
      .all();
    return rows.map((row) => {
      const value = row as Record<string, unknown>;
      return {
        profileId: value.profile_id ? String(value.profile_id) : null,
        accountAddress: value.account_address ? String(value.account_address) : null,
        from: String(value.active_from),
        until: value.active_until ? String(value.active_until) : null,
      };
    });
  }

  insertUsage(input: UsageInsert): boolean {
    const delta = input.event.delta;
    if (
      !delta ||
      (delta.inputTokens === 0n && delta.cachedInputTokens === 0n && delta.outputTokens === 0n)
    ) {
      return false;
    }
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO usage_events(
          profile_id, account_address, working_directory, input_tokens, cached_input_tokens,
          output_tokens, interaction_timestamp, session_id, rollout_path, rollout_ordinal, model,
          source_fingerprint, epoch, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.profileId ?? null,
        input.accountAddress ?? "unknown",
        input.workingDirectory ?? "",
        delta.inputTokens,
        delta.cachedInputTokens,
        delta.outputTokens,
        input.event.event.timestamp,
        input.event.event.sessionId ?? null,
        input.rolloutPath,
        input.event.event.ordinal ?? null,
        input.model ?? input.event.model ?? "unknown",
        input.event.sourceFingerprint,
        input.event.epoch,
        new Date().toISOString(),
      ) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  insertUsageBatch(
    inputs: readonly UsageInsert[],
    rolloutPath: string,
    cursor: RolloutCursor,
  ): void {
    this.database.exec("BEGIN");
    try {
      for (const input of inputs) this.insertUsage({ ...input, rolloutPath });
      this.writeCursor(rolloutPath, cursor);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  totals(filter: UsageFilter = {}): UsageTotals {
    const { where, values } = this.where(filter);
    const row = this.database
      .prepare(
        `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COUNT(*) AS interactions
         FROM usage_events AS u${where}`,
      )
      .all(...values)[0] as Record<string, unknown>;
    const inputTokens = BigInt(String(row.input_tokens ?? 0));
    const cachedInputTokens = BigInt(String(row.cached_input_tokens ?? 0));
    return {
      inputTokens,
      cachedInputTokens,
      uncachedInputTokens: uncached(inputTokens, cachedInputTokens),
      outputTokens: BigInt(String(row.output_tokens ?? 0)),
      interactions: Number(row.interactions ?? 0),
    };
  }

  todayTotals(at = new Date(), filter: UsageFilter = {}): UsageTotals {
    const end = at.toISOString();
    const startDate = new Date(at);
    startDate.setHours(0, 0, 0, 0);
    const start = startDate.toISOString();
    return this.totals({
      ...filter,
      from: filter.from && filter.from > start ? filter.from : start,
      until: filter.until && filter.until < end ? filter.until : end,
    });
  }

  breakdown(filter: UsageFilter = {}): UsageBreakdown[] {
    const { where, values } = this.where(filter);
    const rows = this.database
      .prepare(
        `SELECT COALESCE(NULLIF(p.name, ''), NULLIF(u.account_address, 'unknown'), 'Unknown') AS account_name,
                COALESCE(NULLIF(u.working_directory, ''), 'Unknown') AS working_directory,
                COALESCE(NULLIF(u.model, ''), 'Unknown') AS model,
                SUM(u.input_tokens) AS input_tokens,
                SUM(u.cached_input_tokens) AS cached_input_tokens,
                SUM(u.output_tokens) AS output_tokens,
                COUNT(*) AS interactions
         FROM usage_events AS u
         LEFT JOIN profiles AS p ON p.id = u.profile_id${where}
         GROUP BY account_name, working_directory, model
         ORDER BY account_name, working_directory, model`,
      )
      .all(...values);
    return rows.map((row) => this.toBreakdown(row as Record<string, unknown>));
  }

  filterOptions(filter: UsageFilter = {}): UsageFilterOptions {
    const { where, values } = this.where(filter);
    const rows = this.database
      .prepare(
        `SELECT DISTINCT
                COALESCE(NULLIF(u.model, ''), 'Unknown') AS model,
                COALESCE(NULLIF(u.working_directory, ''), 'Unknown') AS working_directory
         FROM usage_events AS u${where}
         ORDER BY model, working_directory`,
      )
      .all(...values) as readonly Record<string, unknown>[];
    return {
      models: [...new Set(rows.map((row) => String(row.model ?? "Unknown")))],
      workingDirectories: [
        ...new Set(rows.map((row) => String(row.working_directory ?? "Unknown"))),
      ],
    };
  }

  daily(filter: UsageFilter = {}, options: UsageDailyOptions = {}): UsageDaily[] {
    const groupBy = options.groupBy ?? "model";
    const dimension = dailyDimension(groupBy);
    const bucket = dailyBucket(options.granularity ?? "day");
    const { where, values } = this.where(filter);
    const rows = this.database
      .prepare(
        `SELECT ${bucket} AS date,
                ${dimension} AS dimension,
                SUM(u.input_tokens) AS input_tokens,
                SUM(u.cached_input_tokens) AS cached_input_tokens,
                SUM(u.output_tokens) AS output_tokens,
                COUNT(*) AS interactions
         FROM usage_events AS u
         LEFT JOIN profiles AS p ON p.id = u.profile_id${where}
         GROUP BY date, dimension
         ORDER BY date, dimension`,
      )
      .all(...values);
    return rows.map((row) => {
      const value = row as Record<string, unknown>;
      const valueDimension = String(value.dimension ?? "Unknown");
      const inputTokens = BigInt(String(value.input_tokens ?? 0));
      const cachedInputTokens = BigInt(String(value.cached_input_tokens ?? 0));
      const result: UsageDaily = {
        date: String(value.date),
        model: groupBy === "model" ? valueDimension : "Unknown",
        inputTokens,
        cachedInputTokens,
        uncachedInputTokens: uncached(inputTokens, cachedInputTokens),
        outputTokens: BigInt(String(value.output_tokens ?? 0)),
        interactions: Number(value.interactions ?? 0),
      };
      if (groupBy !== "model") result.dimension = valueDimension;
      if (groupBy === "project") result.workingDirectory = valueDimension;
      if (groupBy === "account") result.accountName = valueDimension;
      return result;
    });
  }

  unattributedRanges(): UnattributedUsageRange[] {
    const rows = this.database
      .prepare(
        `SELECT DATE(interaction_timestamp, 'localtime') AS date, COUNT(*) AS events
         FROM usage_events
         WHERE profile_id IS NULL AND account_address = 'unknown'
         GROUP BY date ORDER BY date`,
      )
      .all();
    return rows.map((row) => {
      const value = row as Record<string, unknown>;
      return { date: String(value.date), events: Number(value.events ?? 0) };
    });
  }

  attributeUnknown(
    profileId: string,
    accountAddress: string | null,
    from: string,
    until: string,
  ): number {
    const result = this.database
      .prepare(
        `UPDATE usage_events SET profile_id = ?, account_address = ?
         WHERE profile_id IS NULL AND account_address = 'unknown'
           AND interaction_timestamp >= ? AND interaction_timestamp < ?`,
      )
      .run(profileId, accountAddress ?? "unknown", from, until) as { changes?: number };
    return result.changes ?? 0;
  }

  readCursor(rolloutPath: string): RolloutCursor | undefined {
    const row = this.database
      .prepare("SELECT * FROM usage_cursors WHERE rollout_path = ?")
      .all(rolloutPath)[0];
    if (!row) return undefined;
    const value = row as Record<string, unknown>;
    return {
      byteOffset: Number(value.byte_offset ?? 0),
      partialLine: String(value.partial_line ?? ""),
      fileIdentity: value.file_identity ? String(value.file_identity) : undefined,
      initialized: Boolean(value.initialized),
      lastInputTotal: BigInt(String(value.last_input_total ?? 0)),
      lastCachedInputTotal: BigInt(String(value.last_cached_input_total ?? 0)),
      lastOutputTotal: BigInt(String(value.last_output_total ?? 0)),
      epoch: Number(value.epoch ?? 0),
      lastEventTimestamp: value.last_event_timestamp
        ? String(value.last_event_timestamp)
        : undefined,
      workingDirectory: value.working_directory ? String(value.working_directory) : undefined,
      model: value.model ? String(value.model) : undefined,
    };
  }

  writeCursor(rolloutPath: string, cursor: RolloutCursor): void {
    this.database
      .prepare(
        `INSERT INTO usage_cursors(
          rollout_path, file_identity, byte_offset, partial_line, last_input_total,
          last_cached_input_total, last_output_total, last_event_timestamp, epoch, initialized,
          updated_at, working_directory, model
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(rollout_path) DO UPDATE SET file_identity=excluded.file_identity,
          byte_offset=excluded.byte_offset, partial_line=excluded.partial_line,
          last_input_total=excluded.last_input_total, last_cached_input_total=excluded.last_cached_input_total,
          last_output_total=excluded.last_output_total, last_event_timestamp=excluded.last_event_timestamp,
          epoch=excluded.epoch, initialized=excluded.initialized, updated_at=excluded.updated_at,
          working_directory=excluded.working_directory, model=excluded.model`,
      )
      .run(
        rolloutPath,
        cursor.fileIdentity ?? null,
        cursor.byteOffset,
        cursor.partialLine,
        cursor.lastInputTotal ?? 0n,
        cursor.lastCachedInputTotal ?? 0n,
        cursor.lastOutputTotal ?? 0n,
        cursor.lastEventTimestamp ?? null,
        cursor.epoch,
        cursor.initialized ? 1 : 0,
        new Date().toISOString(),
        cursor.workingDirectory ?? null,
        cursor.model ?? null,
      );
  }

  private where(filter: UsageFilter): { where: string; values: unknown[] } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.profileId) {
      conditions.push("u.profile_id = ?");
      values.push(filter.profileId);
    }
    if (filter.accountAddress) {
      conditions.push("u.account_address = ?");
      values.push(filter.accountAddress);
    }
    if (filter.model) {
      conditions.push("u.model = ?");
      values.push(filter.model);
    }
    if (filter.workingDirectory) {
      conditions.push("u.working_directory = ?");
      values.push(filter.workingDirectory);
    }
    if (filter.from) {
      conditions.push("u.interaction_timestamp >= ?");
      values.push(filter.from);
    }
    if (filter.until) {
      conditions.push("u.interaction_timestamp < ?");
      values.push(filter.until);
    }
    return {
      where: conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "",
      values,
    };
  }

  private toBreakdown(value: Record<string, unknown>): UsageBreakdown {
    return {
      accountName: String(value.account_name ?? "Unknown"),
      workingDirectory: String(value.working_directory ?? "Unknown"),
      model: String(value.model ?? "Unknown"),
      inputTokens: BigInt(String(value.input_tokens ?? 0)),
      cachedInputTokens: BigInt(String(value.cached_input_tokens ?? 0)),
      outputTokens: BigInt(String(value.output_tokens ?? 0)),
      uncachedInputTokens: uncached(
        BigInt(String(value.input_tokens ?? 0)),
        BigInt(String(value.cached_input_tokens ?? 0)),
      ),
      totalTokens:
        BigInt(String(value.input_tokens ?? 0)) + BigInt(String(value.output_tokens ?? 0)),
      interactions: Number(value.interactions ?? 0),
    };
  }
}

function uncached(input: bigint, cached: bigint): bigint {
  return input > cached ? input - cached : 0n;
}

function dailyDimension(groupBy: UsageDailyGroupBy): string {
  switch (groupBy) {
    case "project":
      return "COALESCE(NULLIF(u.working_directory, ''), 'Unknown')";
    case "account":
      return "COALESCE(NULLIF(p.name, ''), NULLIF(u.account_address, 'unknown'), 'Unknown')";
    default:
      return "COALESCE(NULLIF(u.model, ''), 'Unknown')";
  }
}

function dailyBucket(granularity: UsageDailyGranularity): string {
  switch (granularity) {
    case "hour":
      return "strftime('%Y-%m-%dT%H:00:00', u.interaction_timestamp, 'localtime')";
    case "week":
      return "date(u.interaction_timestamp, 'localtime', '-' || ((CAST(strftime('%w', u.interaction_timestamp, 'localtime') AS INTEGER) + 6) % 7) || ' days')";
    case "month":
      return "strftime('%Y-%m', u.interaction_timestamp, 'localtime')";
    default:
      return "DATE(u.interaction_timestamp, 'localtime')";
  }
}
