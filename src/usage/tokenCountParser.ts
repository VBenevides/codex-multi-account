import { createHash } from "node:crypto";

export interface TokenUsageDelta {
  inputTokens: bigint;
  cachedInputTokens: bigint;
  outputTokens: bigint;
}

export interface ParsedTokenEvent {
  timestamp: string;
  sessionId?: string;
  ordinal?: number;
  total: TokenUsageDelta;
  last?: TokenUsageDelta;
}

export interface TokenCountState {
  initialized: boolean;
  lastInputTotal?: bigint;
  lastCachedInputTotal?: bigint;
  lastOutputTotal?: bigint;
  epoch: number;
  lastEventTimestamp?: string;
}

export interface TokenObservation {
  delta?: TokenUsageDelta;
  epoch: number;
  reset: boolean;
  diagnostic?: "ambiguous-reset";
}

const INTEGER = /^\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: Record<string, unknown>, snake: string, camel: string): unknown {
  return value[snake] ?? value[camel];
}

function parseCount(value: unknown, name: string, required: boolean): bigint {
  if (value === undefined || value === null) {
    if (!required) return 0n;
    throw new Error(`token_count ${name} is missing`);
  }

  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`token_count ${name} must be non-negative`);
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`token_count ${name} must be a safe non-negative integer`);
    }
    return BigInt(value);
  }

  if (typeof value === "string" && INTEGER.test(value)) return BigInt(value);
  throw new Error(`token_count ${name} must be a non-negative integer`);
}

function parseUsage(value: unknown, name: string): TokenUsageDelta {
  if (!isRecord(value)) throw new Error(`token_count ${name} is missing`);
  return {
    inputTokens: parseCount(
      field(value, "input_tokens", "inputTokens"),
      `${name}.input_tokens`,
      true,
    ),
    cachedInputTokens: parseCount(
      field(value, "cached_input_tokens", "cachedInputTokens"),
      `${name}.cached_input_tokens`,
      false,
    ),
    outputTokens: parseCount(
      field(value, "output_tokens", "outputTokens"),
      `${name}.output_tokens`,
      true,
    ),
  };
}

function parseOrdinal(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const ordinal = typeof value === "string" && INTEGER.test(value) ? Number(value) : value;
  if (typeof ordinal !== "number" || !Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new Error("token_count ordinal must be a non-negative safe integer");
  }
  return ordinal;
}

/** Parse one decoded rollout record. Non-token records return undefined. */
export function parseTokenCountEvent(value: unknown): ParsedTokenEvent | undefined {
  if (!isRecord(value) || value.type !== "event_msg") return undefined;
  const payload = value.payload;
  if (!isRecord(payload) || payload.type !== "token_count") return undefined;

  if (typeof value.timestamp !== "string" || value.timestamp.length === 0) {
    throw new Error("token_count timestamp is missing");
  }

  const info = payload.info;
  if (!isRecord(info)) throw new Error("token_count info is missing");

  const sessionId = [value.session_id, value.sessionId, payload.session_id, payload.sessionId].find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  );

  const ordinal = parseOrdinal(value.ordinal);
  return {
    timestamp: value.timestamp,
    ...(sessionId ? { sessionId } : {}),
    ...(ordinal === undefined ? {} : { ordinal }),
    total: parseUsage(info.total_token_usage, "total_token_usage"),
    ...(info.last_token_usage == null
      ? {}
      : { last: parseUsage(info.last_token_usage, "last_token_usage") }),
  };
}

export function parseTokenCountLine(line: string): ParsedTokenEvent | undefined {
  return parseTokenCountEvent(JSON.parse(line));
}

export const parseTokenCount = parseTokenCountEvent;

function zeroDelta(): TokenUsageDelta {
  return { inputTokens: 0n, cachedInputTokens: 0n, outputTokens: 0n };
}

function subtract(current: TokenUsageDelta, previous: TokenUsageDelta): TokenUsageDelta {
  return {
    inputTokens: current.inputTokens - previous.inputTokens,
    cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
  };
}

function allLessOrEqual(current: TokenUsageDelta, previous: TokenUsageDelta): boolean {
  return (
    current.inputTokens <= previous.inputTokens &&
    current.cachedInputTokens <= previous.cachedInputTokens &&
    current.outputTokens <= previous.outputTokens
  );
}

function hasDecrease(current: TokenUsageDelta, previous: TokenUsageDelta): boolean {
  return (
    current.inputTokens < previous.inputTokens ||
    current.cachedInputTokens < previous.cachedInputTokens ||
    current.outputTokens < previous.outputTokens
  );
}

function canCountReset(last: TokenUsageDelta | undefined, total: TokenUsageDelta): boolean {
  return !!last && allLessOrEqual(last, total);
}

export class TokenCountAccumulator {
  private stateValue: TokenCountState;

  constructor(
    state?: Partial<TokenCountState>,
    private readonly backfillFirst = false,
  ) {
    this.stateValue = {
      initialized: state?.initialized ?? false,
      lastInputTotal: state?.lastInputTotal,
      lastCachedInputTotal: state?.lastCachedInputTotal,
      lastOutputTotal: state?.lastOutputTotal,
      epoch: state?.epoch ?? 0,
      lastEventTimestamp: state?.lastEventTimestamp,
    };
  }

  get state(): TokenCountState {
    return { ...this.stateValue };
  }

  observe(event: ParsedTokenEvent): TokenObservation {
    const previous = this.stateValue.initialized
      ? {
          inputTokens: this.stateValue.lastInputTotal ?? 0n,
          cachedInputTokens: this.stateValue.lastCachedInputTotal ?? 0n,
          outputTokens: this.stateValue.lastOutputTotal ?? 0n,
        }
      : undefined;

    let result: TokenObservation;
    if (!previous) {
      result = {
        delta: this.backfillFirst ? (event.last ?? event.total) : undefined,
        epoch: this.stateValue.epoch,
        reset: false,
      };
    } else if (!hasDecrease(event.total, previous)) {
      result = {
        delta: subtract(event.total, previous),
        epoch: this.stateValue.epoch,
        reset: false,
      };
    } else if (allLessOrEqual(event.total, previous) && canCountReset(event.last, event.total)) {
      this.stateValue.epoch += 1;
      result = { delta: event.last, epoch: this.stateValue.epoch, reset: true };
    } else {
      result = { epoch: this.stateValue.epoch, reset: false, diagnostic: "ambiguous-reset" };
      this.stateValue.lastEventTimestamp = event.timestamp;
      return result;
    }

    this.stateValue.initialized = true;
    this.stateValue.lastInputTotal = event.total.inputTokens;
    this.stateValue.lastCachedInputTotal = event.total.cachedInputTokens;
    this.stateValue.lastOutputTotal = event.total.outputTokens;
    this.stateValue.lastEventTimestamp = event.timestamp;
    return result;
  }
}

export function createTokenCountState(): TokenCountState {
  return { initialized: false, epoch: 0 };
}

export function zeroTokenUsage(): TokenUsageDelta {
  return zeroDelta();
}

export function tokenEventFingerprint(rolloutPath: string, event: ParsedTokenEvent): string {
  const payload = [
    rolloutPath,
    event.ordinal ?? "",
    event.timestamp,
    event.total.inputTokens,
    event.total.cachedInputTokens,
    event.total.outputTokens,
  ].join("\u0000");
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}
