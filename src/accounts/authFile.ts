import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  extractAuthIdentity,
  extractStructuredAuthIdentity,
  type AuthIdentity,
} from "./accountIdentity.js";

export interface AuthFingerprint {
  value: string;
}

export interface ParsedAuthFile {
  data: Record<string, unknown>;
  bytes: Uint8Array;
  fingerprint: AuthFingerprint;
  identity: AuthIdentity;
  structuredIdentity: AuthIdentity;
}

type AuthInput = string | Uint8Array;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasCredentials(data: Record<string, unknown>): boolean {
  if (hasText(data.OPENAI_API_KEY)) return true;
  if (["access_token", "refresh_token", "id_token", "api_key"].some((key) => hasText(data[key]))) {
    return true;
  }
  return (
    isRecord(data.tokens) &&
    ["access_token", "refresh_token", "id_token", "api_key"].some((key) =>
      hasText((data.tokens as Record<string, unknown>)[key]),
    )
  );
}

export function validateAuthData(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value) || !hasCredentials(value)) {
    throw new Error("Invalid auth file structure.");
  }
}

export function fingerprintAuth(input: AuthInput): AuthFingerprint {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return { value: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

export function parseAuthFile(input: AuthInput): ParsedAuthFile {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Invalid auth file: malformed JSON.");
  }

  try {
    validateAuthData(value);
  } catch {
    throw new Error("Invalid auth file: missing credential data.");
  }

  return {
    data: value,
    bytes,
    fingerprint: fingerprintAuth(bytes),
    identity: extractAuthIdentity(value),
    structuredIdentity: extractStructuredAuthIdentity(value),
  };
}

export async function readAuthFile(filePath: string): Promise<ParsedAuthFile> {
  try {
    return parseAuthFile(await readFile(filePath));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid auth file:")) throw error;
    throw new Error("Unable to read auth file.");
  }
}

export class AuthFile {
  static parse = parseAuthFile;
  static read = readAuthFile;
  static fingerprint = fingerprintAuth;
  static validate = validateAuthData;

  parse(input: AuthInput): ParsedAuthFile {
    return parseAuthFile(input);
  }

  read(filePath: string): Promise<ParsedAuthFile> {
    return readAuthFile(filePath);
  }
}
