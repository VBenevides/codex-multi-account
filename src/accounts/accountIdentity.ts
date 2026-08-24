export interface AuthIdentity {
  email?: string;
  chatgptUserId?: string;
  accountId?: string;
  authMode?: string;
}

export function sameKnownIdentity(left: AuthIdentity, right: AuthIdentity): boolean {
  const keys = ["email", "chatgptUserId", "accountId"] as const;
  const known = keys.filter((key) => left[key] || right[key]);
  return known.length > 0 && known.every((key) => left[key] === right[key]);
}

type AuthRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AuthRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result.length > 0 && result.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(result)
    ? result
    : undefined;
}

function firstValue(containers: AuthRecord[], keys: string[]): string | undefined {
  for (const container of containers) {
    for (const key of keys) {
      const value = safeValue(container[key]);
      if (value) return value;
    }
  }
  return undefined;
}

function decodeJwtPayload(token: string): AuthRecord | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const value: unknown = JSON.parse(payload);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function extractStructuredAuthIdentity(auth: unknown): AuthIdentity {
  if (!isRecord(auth)) return {};

  const tokens = isRecord(auth.tokens) ? auth.tokens : undefined;
  const containers = [
    auth,
    ...(tokens ? [tokens] : []),
    ...(isRecord(auth.identity) ? [auth.identity] : []),
    ...(isRecord(auth.account) ? [auth.account] : []),
    ...(isRecord(auth.user) ? [auth.user] : []),
    ...(isRecord(auth.profile) ? [auth.profile] : []),
  ];
  return identityFromContainers(containers, auth, true);
}

export function extractAuthIdentity(auth: unknown): AuthIdentity {
  if (!isRecord(auth)) return {};

  const structured = extractStructuredAuthIdentity(auth);
  const tokens = isRecord(auth.tokens) ? auth.tokens : undefined;

  const jwtClaims = [auth.id_token, tokens?.id_token, auth.access_token, tokens?.access_token]
    .map((value) => (typeof value === "string" ? decodeJwtPayload(value) : undefined))
    .filter((value): value is AuthRecord => value !== undefined);

  const nestedClaims = jwtClaims.flatMap((claims) => [
    claims,
    ...(isRecord(claims["https://api.openai.com/profile"])
      ? [claims["https://api.openai.com/profile"]]
      : []),
    ...(isRecord(claims["https://api.openai.com/auth"])
      ? [claims["https://api.openai.com/auth"]]
      : []),
  ]);
  const unverified = identityFromContainers(nestedClaims, auth, false);

  return {
    ...((structured.email ?? unverified.email)
      ? { email: structured.email ?? unverified.email }
      : {}),
    ...((structured.chatgptUserId ?? unverified.chatgptUserId)
      ? { chatgptUserId: structured.chatgptUserId ?? unverified.chatgptUserId }
      : {}),
    ...((structured.accountId ?? unverified.accountId)
      ? { accountId: structured.accountId ?? unverified.accountId }
      : {}),
    ...((structured.authMode ?? unverified.authMode)
      ? { authMode: structured.authMode ?? unverified.authMode }
      : {}),
  };
}

function identityFromContainers(
  containers: AuthRecord[],
  auth: AuthRecord,
  includeApiKeyMode: boolean,
): AuthIdentity {
  const email = firstValue(containers, [
    "email",
    "account_email",
    "accountAddress",
    "account_address",
  ]);
  const chatgptUserId = firstValue(containers, [
    "chatgptUserId",
    "chatgpt_user_id",
    "userId",
    "user_id",
    "sub",
  ]);
  const accountId = firstValue(containers, [
    "accountId",
    "account_id",
    "chatgptAccountId",
    "chatgpt_account_id",
  ]);
  const authMode = firstValue(containers, ["authMode", "auth_mode"]);
  return {
    ...(email ? { email } : {}),
    ...(chatgptUserId ? { chatgptUserId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(authMode || (includeApiKeyMode && safeValue(auth.OPENAI_API_KEY))
      ? { authMode: authMode ?? "apiKey" }
      : {}),
  };
}
