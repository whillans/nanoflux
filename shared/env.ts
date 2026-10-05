import { existsSync } from "node:fs";
import { readLiteralEnvValue } from "./dotenv-literal";
import { passwordStrengthError } from "./password-strength";

export function resolvePort(): number {
  const raw = Bun.env.PORT?.trim();
  if (!raw) {
    throw new Error(
      "PORT is not set. Copy .env.example to .env and set PORT.",
    );
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

/**
 * Without TLS NanoFlux serves plain HTTP, so by default it is reachable only
 * from this machine. Any other address puts the password, session cookie, and
 * MCP token on the network in the clear unless `TLS_CERT_FILE`/`TLS_KEY_FILE`
 * are set or an HTTPS reverse proxy sits in front.
 */
export const DEFAULT_HOST = "127.0.0.1";

export type TlsFiles = { certFile: string; keyFile: string };

/**
 * Certificate and key for serving HTTPS directly, or `null` for plain HTTP.
 * `TLS_CERT_FILE` must hold the full chain (leaf first) in PEM format.
 */
export function resolveTls(): TlsFiles | null {
  const certFile = Bun.env.TLS_CERT_FILE?.trim();
  const keyFile = Bun.env.TLS_KEY_FILE?.trim();
  if (!certFile && !keyFile) return null;
  if (!certFile || !keyFile) {
    throw new Error(
      "TLS_CERT_FILE and TLS_KEY_FILE must be set together.",
    );
  }
  for (const [name, path] of [
    ["TLS_CERT_FILE", certFile],
    ["TLS_KEY_FILE", keyFile],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(`${name} does not exist: ${path}`);
    }
  }
  return { certFile, keyFile };
}

/** Listen address; set `HOST=0.0.0.0` to accept connections on all interfaces. */
export function resolveHost(): string {
  return Bun.env.HOST?.trim() || DEFAULT_HOST;
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

export function resolveAdminPassword(): string {
  const fromFile = readLiteralEnvValue("ADMIN_PASSWORD");
  if (fromFile !== undefined) return fromFile.trim();
  return Bun.env.ADMIN_PASSWORD?.trim() ?? "";
}

export function adminPasswordStrengthError(password: string): string | null {
  return passwordStrengthError(password, "ADMIN_PASSWORD");
}

/** Fail startup when ADMIN_PASSWORD is missing or too weak. */
export function requireAdminPassword(): string {
  const password = resolveAdminPassword();
  if (!password) {
    throw new Error(
      "ADMIN_PASSWORD is not set. Copy .env.example to .env and set ADMIN_PASSWORD.",
    );
  }
  const strengthError = adminPasswordStrengthError(password);
  if (strengthError) {
    throw new Error(strengthError);
  }
  return password;
}
