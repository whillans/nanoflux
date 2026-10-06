import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIPv6 } from "node:net";

export const ADMIN_SESSION_COOKIE = "nanoflux_session";
export const ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const AUTH_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_FAILURES = 20;
/** Budget shared by a whole IPv6 /48, the largest block one customer usually holds. */
const AUTH_MAX_FAILURES_PER_SITE = 100;
const AUTH_MAX_TRACKED_CLIENTS = 10_000;

/** Each credential has its own failure budget per client. */
export type AuthScope = "admin" | "fever" | "mcp";
export type AuthResult = "ok" | "unauthorized" | "blocked";

type FailureBucket = { count: number; resetAt: number };
const authFailures = new Map<string, FailureBucket>();

const SESSION_MAX_ACTIVE = 1_000;

/**
 * Sessions live in memory, keyed by the SHA-256 of the token, so they can be
 * revoked on logout and a leaked cookie reveals nothing about the password.
 * A restart drops every session.
 */
const sessions = new Map<string, number>();

function sessionKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function passwordsEqual(given: string, expected: string): boolean {
  const left = Buffer.from(given, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) {
    if (right.length > 0) timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Every session gets the same TTL, so the map stays in expiry order and the
 * expired ones are always at the front.
 */
function pruneSessions(now: number): void {
  for (const [key, expiresAt] of sessions) {
    if (expiresAt > now) break;
    sessions.delete(key);
  }
}

export function createSessionToken(now = Date.now()): string {
  pruneSessions(now);
  if (sessions.size >= SESSION_MAX_ACTIVE) {
    const oldest = sessions.keys().next().value;
    if (oldest !== undefined) sessions.delete(oldest);
  }
  const token = randomBytes(32).toString("base64url");
  sessions.set(sessionKey(token), now + ADMIN_SESSION_TTL_SECONDS * 1000);
  return token;
}

export function verifySessionToken(
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const key = sessionKey(token);
  const expiresAt = sessions.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt <= now) {
    sessions.delete(key);
    return false;
  }
  return true;
}

export function revokeSessionToken(token: string | undefined): void {
  if (token) sessions.delete(sessionKey(token));
}

export function readSessionCookie(request: Request): string | undefined {
  return readCookie(request.headers.get("cookie"), ADMIN_SESSION_COOKIE);
}

export function readCookie(
  header: string | null,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return rest.join("=");
  }
  return undefined;
}

export function readBearer(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

/**
 * A Bearer header is a password guess like any login attempt, so wrong ones
 * count against the client and a blocked client is refused before the
 * comparison. Session tokens are random and unguessable; a valid one is
 * accepted regardless, so a blocked address does not lock out its signed-in
 * users.
 */
export function authenticateRequest(
  request: Request,
  secret: string,
  client: string,
): AuthResult {
  if (verifySessionToken(readSessionCookie(request))) return "ok";
  const bearer = readBearer(request.headers.get("authorization"));
  if (!bearer) return "unauthorized";
  return checkCredential("admin", client, passwordsEqual(bearer, secret));
}

/**
 * Rate-limited verdict for a presented credential. `matches` is computed by
 * the caller, but is ignored while the client is blocked, so a blocked client
 * learns nothing from further guesses.
 */
export function checkCredential(
  scope: AuthScope,
  client: string,
  matches: boolean,
  now = Date.now(),
): AuthResult {
  if (isAuthBlocked(scope, client, now)) return "blocked";
  if (matches) return "ok";
  recordAuthFailure(scope, client, now);
  return "unauthorized";
}

export function sessionCookieHeader(
  token: string | null,
  secure: boolean,
): string {
  if (!token) {
    return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function isSecureRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === "https:") return true;
  const forwarded = request.headers.get("x-forwarded-proto");
  return forwarded?.split(",")[0]?.trim() === "https";
}

/**
 * Buckets are only ever appended with the same window, so the map stays in
 * expiry order and the expired ones are always at the front.
 */
function pruneAuthFailures(now: number): void {
  for (const [key, bucket] of authFailures) {
    if (bucket.resetAt > now) break;
    authFailures.delete(key);
  }
}

/** The eight 16-bit groups of an IPv6 address, or null if it is not one. */
function ipv6Groups(address: string): number[] | null {
  if (!isIPv6(address)) return null;
  const parse = (part: string): number[] =>
    part === ""
      ? []
      : part.split(":").flatMap((group) => {
          if (!group.includes(".")) return [parseInt(group, 16)];
          const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number);
          return [(a << 8) | b, (c << 8) | d];
        });
  const [head = "", tail] = address.split("::");
  const leading = parse(head);
  const trailing = tail === undefined ? [] : parse(tail);
  const zeros = new Array<number>(8 - leading.length - trailing.length).fill(0);
  return [...leading, ...zeros, ...trailing];
}

/**
 * The buckets a client's failures count against, each with its own limit.
 * One IPv6 subscriber owns at least a /64, so counting per address would hand
 * out a fresh budget for every address they pick; the /64 is the client, and
 * the enclosing /48 gets a larger shared budget for those who hold more.
 * IPv4-mapped addresses count as the IPv4 address they carry.
 */
export function failureBuckets(
  scope: AuthScope,
  client: string,
): { key: string; limit: number }[] {
  const address = client.replace(/^\[|\](:\d+)?$/g, "").split("%")[0] ?? "";
  const groups = ipv6Groups(address);
  if (!groups) return [{ key: `${scope}:${client}`, limit: AUTH_MAX_FAILURES }];

  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups;
  if (!g0 && !g1 && !g2 && !g3 && !g4 && g5 === 0xffff) {
    const ipv4 = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join(".");
    return [{ key: `${scope}:${ipv4}`, limit: AUTH_MAX_FAILURES }];
  }
  const prefix = (count: number) =>
    groups.slice(0, count).map((group) => group.toString(16)).join(":");
  return [
    { key: `${scope}:${prefix(4)}::/64`, limit: AUTH_MAX_FAILURES },
    { key: `${scope}:${prefix(3)}::/48`, limit: AUTH_MAX_FAILURES_PER_SITE },
  ];
}

function isAuthBlocked(scope: AuthScope, client: string, now: number): boolean {
  pruneAuthFailures(now);
  return failureBuckets(scope, client).some(({ key, limit }) => {
    const bucket = authFailures.get(key);
    return bucket !== undefined && bucket.count >= limit;
  });
}

/**
 * Only failures are counted: API clients send their credential on every
 * request, so counting successes would lock out legitimate use.
 */
function recordAuthFailure(scope: AuthScope, client: string, now: number): void {
  pruneAuthFailures(now);
  for (const { key } of failureBuckets(scope, client)) {
    const existing = authFailures.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    if (authFailures.size >= AUTH_MAX_TRACKED_CLIENTS) {
      const oldest = authFailures.keys().next().value;
      if (oldest !== undefined) authFailures.delete(oldest);
    }
    authFailures.set(key, { count: 1, resetAt: now + AUTH_FAILURE_WINDOW_MS });
  }
}
