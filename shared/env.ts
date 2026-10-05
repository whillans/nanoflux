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

export const DEFAULT_HOST = "0.0.0.0";

/** Listen address; `127.0.0.1` keeps NanoFlux reachable only from this machine. */
export function resolveHost(): string {
  return Bun.env.HOST?.trim() || DEFAULT_HOST;
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
