import { open } from "node:fs/promises";
import {
  ParsedTokenEvent,
  TokenCountAccumulator,
  TokenCountState,
  TokenUsageDelta,
  parseTokenCountEvent,
  tokenEventFingerprint,
} from "./tokenCountParser.js";

export interface RolloutCursor extends TokenCountState {
  byteOffset: number;
  partialLine: string;
  fileIdentity?: string;
  discardingLine?: boolean;
  workingDirectory?: string;
  model?: string;
}

export interface TailedTokenEvent {
  event: ParsedTokenEvent;
  delta?: TokenUsageDelta;
  epoch: number;
  sourceFingerprint: string;
  model?: string;
}

export interface RolloutTailResult {
  events: TailedTokenEvent[];
  cursor: RolloutCursor;
  diagnostics: string[];
}

export interface RolloutTailerOptions {
  chunkBytes?: number;
  maxCandidateLineBytes?: number;
  prefixBytes?: number;
}

export interface TailOptions {
  startAt?: "eof" | "beginning";
  backfillFirst?: boolean;
}

const DEFAULT_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_CANDIDATE_LINE_BYTES = 1024 * 1024;
const DEFAULT_PREFIX_BYTES = 1024;

function fileIdentity(value: { dev?: number; ino?: number }): string {
  return `${value.dev ?? "?"}:${value.ino ?? "?"}`;
}

function emptyCursor(): RolloutCursor {
  return { byteOffset: 0, partialLine: "", initialized: false, epoch: 0 };
}

function cloneCursor(cursor: RolloutCursor): RolloutCursor {
  return { ...cursor };
}

function isTokenCandidate(line: Buffer, prefixBytes: number): boolean {
  const prefix = line.subarray(0, prefixBytes).toString("utf8");
  return /"type"\s*:\s*"event_msg"/.test(prefix) && /"type"\s*:\s*"token_count"/.test(prefix);
}

interface RolloutMetadata {
  workingDirectory?: string;
  model?: string;
}

function decodeString(value: string): string | undefined {
  try {
    const decoded: unknown = JSON.parse(`"${value}"`);
    return typeof decoded === "string" && decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function extractMetadata(line: Buffer, prefixBytes: number): RolloutMetadata {
  const text = line.toString("utf8");
  const prefix = text.slice(0, prefixBytes);
  const type = /"type"\s*:\s*"(session_meta|turn_context)"/.exec(prefix)?.[1];
  if (!type) return {};
  const cwd = /"cwd"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(text)?.[1];
  const model =
    type === "turn_context" ? /"model"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(text)?.[1] : undefined;
  return {
    ...(cwd ? { workingDirectory: decodeString(cwd) } : {}),
    ...(model ? { model: decodeString(model) } : {}),
  };
}

export class RolloutTailer {
  private readonly chunkBytes: number;
  private readonly maxCandidateLineBytes: number;
  private readonly prefixBytes: number;

  constructor(options: RolloutTailerOptions = {}) {
    this.chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    this.maxCandidateLineBytes = options.maxCandidateLineBytes ?? DEFAULT_MAX_CANDIDATE_LINE_BYTES;
    this.prefixBytes = options.prefixBytes ?? DEFAULT_PREFIX_BYTES;
  }

  async tail(
    filePath: string,
    savedCursor?: RolloutCursor,
    options: TailOptions = {},
  ): Promise<RolloutTailResult> {
    let cursor = cloneCursor(savedCursor ?? emptyCursor());
    const diagnostics: string[] = [];
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(filePath, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { events: [], cursor, diagnostics };
      diagnostics.push("rollout file could not be opened");
      return { events: [], cursor, diagnostics };
    }

    try {
      const fileStat = await handle.stat();
      const identity = fileIdentity(fileStat);
      const replaced = cursor.fileIdentity !== undefined && cursor.fileIdentity !== identity;
      const truncated = cursor.byteOffset > fileStat.size;

      if (replaced || truncated) {
        cursor = {
          ...emptyCursor(),
          byteOffset: 0,
          fileIdentity: identity,
          epoch: cursor.epoch + 1,
        };
      } else {
        cursor.fileIdentity = identity;
      }

      if (savedCursor === undefined && options.startAt !== "beginning") {
        const prefix = Buffer.alloc(Math.min(fileStat.size, this.maxCandidateLineBytes));
        const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
        const metadata = extractMetadata(prefix.subarray(0, bytesRead), this.prefixBytes);
        cursor.workingDirectory = metadata.workingDirectory;
        cursor.model = metadata.model;
        cursor.byteOffset = fileStat.size;
        return { events: [], cursor, diagnostics };
      }

      const accumulator = new TokenCountAccumulator(cursor, options.backfillFirst ?? false);
      const events: TailedTokenEvent[] = [];
      let offset = cursor.byteOffset;
      let partial = Buffer.from(cursor.partialLine, "utf8");
      let discardingLine = cursor.discardingLine ?? false;
      let workingDirectory = cursor.workingDirectory;
      let model = cursor.model;
      let remaining = Math.max(0, fileStat.size - offset);

      while (remaining > 0) {
        const buffer = Buffer.allocUnsafe(Math.min(this.chunkBytes, remaining));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        offset += bytesRead;
        remaining -= bytesRead;

        let start = 0;
        while (start < chunk.length) {
          const newline = chunk.indexOf(0x0a, start);
          if (newline < 0) {
            const fragment = chunk.subarray(start);
            if (!discardingLine) partial = Buffer.concat([partial, fragment]);
            if (!discardingLine) {
              const metadata = extractMetadata(partial, this.prefixBytes);
              workingDirectory = metadata.workingDirectory ?? workingDirectory;
              model = metadata.model ?? model;
            }
            if (!discardingLine && partial.length > this.maxCandidateLineBytes) {
              diagnostics.push(`rollout line skipped: size>${this.maxCandidateLineBytes}`);
              partial = Buffer.alloc(0);
              discardingLine = true;
            }
            break;
          }

          const fragment = chunk.subarray(start, newline);
          if (!discardingLine) partial = Buffer.concat([partial, fragment]);
          if (!discardingLine) {
            const metadata = extractMetadata(partial, this.prefixBytes);
            workingDirectory = metadata.workingDirectory ?? workingDirectory;
            model = metadata.model ?? model;
          }
          if (!discardingLine && partial.length <= this.maxCandidateLineBytes) {
            this.parseLine(filePath, identity, partial, accumulator, events, diagnostics, model);
          } else if (!discardingLine) {
            diagnostics.push(`rollout line skipped: size>${this.maxCandidateLineBytes}`);
          }
          partial = Buffer.alloc(0);
          discardingLine = false;
          start = newline + 1;
        }
      }

      const state = accumulator.state;
      cursor = {
        ...cursor,
        ...state,
        byteOffset: offset,
        partialLine: discardingLine ? "" : partial.toString("utf8"),
        discardingLine,
        fileIdentity: identity,
        workingDirectory,
        model,
      };
      return { events, cursor, diagnostics };
    } finally {
      await handle.close();
    }
  }

  tailFile = this.tail.bind(this);

  private parseLine(
    filePath: string,
    identity: string,
    line: Buffer,
    accumulator: TokenCountAccumulator,
    events: TailedTokenEvent[],
    diagnostics: string[],
    model: string | undefined,
  ): void {
    if (!isTokenCandidate(line, this.prefixBytes)) return;
    try {
      const event = parseTokenCountEvent(JSON.parse(line.toString("utf8")));
      if (!event) return;
      const observation = accumulator.observe(event);
      events.push({
        event,
        delta: observation.delta,
        epoch: observation.epoch,
        sourceFingerprint: tokenEventFingerprint(filePath, event),
        ...(model ? { model } : {}),
      });
      if (observation.diagnostic) diagnostics.push(`token_count ${observation.diagnostic}`);
    } catch {
      diagnostics.push(`token_count line skipped: size=${line.length}`);
    }
  }
}
