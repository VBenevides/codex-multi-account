import type * as vscode from "vscode";

const SECRET_PATTERNS = [
  /((?:"|')?(?:access|refresh|id)[_-]?token(?:"|')?\s*[:=]\s*["'])[^"'\\]*(?=["'])/gi,
  /((?:"|')?(?:openai[_-]?api[_-]?key|api[_-]?key|authorization|password|secret)(?:"|')?\s*[:=]\s*["'])[^"'\\]*(?=["'])/gi,
  /(\bBearer\s+)[A-Za-z0-9._~-]+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

export function redactSecrets(value: string): string {
  const structured = parseStructured(value);
  if (structured && looksLikeAuth(structured)) return "[REDACTED auth JSON]";
  if (structured && looksLikeRollout(structured)) return "[REDACTED rollout content]";
  return SECRET_PATTERNS.reduce(
    (text, pattern) =>
      text.replace(pattern, (match, prefix?: string) => `${prefix ?? ""}[REDACTED]`),
    value,
  );
}

const SENSITIVE_KEYS =
  /(?:access|refresh|id)?[_-]?token|api[_-]?key|authorization|password|secret|credential|auth(?:entication)?(?:file|json)?|payload|content|message|rollout|raw|line/iu;

function parseStructured(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function looksLikeAuth(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) =>
    /^(?:auth|auth[_-]?(?:file|json)|openai[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|tokens|credentials?)$/iu.test(
      key,
    ),
  );
}

function looksLikeRollout(value: Record<string, unknown>): boolean {
  return value.type === "event_msg" || "payload" in value || "rollout" in value;
}

function sanitize(value: unknown, key: string | undefined, seen: WeakSet<object>): unknown {
  if (key && SENSITIVE_KEYS.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value === "bigint") return value.toString();
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, undefined, seen));
  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value))
    result[childKey] = sanitize(childValue, childKey, seen);
  return result;
}

export class Logger {
  private readonly channel: vscode.OutputChannel;

  constructor(channel?: vscode.OutputChannel) {
    this.channel =
      channel ??
      (require("vscode") as typeof vscode).window.createOutputChannel("Codex Multi Account");
  }

  debug(message: string, details?: Record<string, unknown>): void {
    this.write("DEBUG", message, details);
  }

  info(message: string, details?: Record<string, unknown>): void {
    this.write("INFO", message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.write("WARN", message, details);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.write("ERROR", message, details);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private write(level: string, message: string, details?: Record<string, unknown>): void {
    const safeMessage = redactSecrets(message);
    const safeDetails =
      details === undefined
        ? ""
        : ` ${JSON.stringify(sanitize(details, undefined, new WeakSet()))}`;
    this.channel.appendLine(
      `[${new Date().toISOString()}] ${level} ${safeMessage}${redactSecrets(safeDetails)}`,
    );
  }
}
