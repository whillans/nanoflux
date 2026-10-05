import { join } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const DB_PATH = Bun.env.DB_PATH ?? "data.sqlite";

const sqlite = new Database(DB_PATH);

sqlite.run("PRAGMA journal_mode = WAL");
sqlite.run("PRAGMA synchronous = NORMAL");
sqlite.run("PRAGMA auto_vacuum = INCREMENTAL");
sqlite.run("PRAGMA busy_timeout = 5000");
sqlite.run("PRAGMA journal_size_limit = 67108864");
sqlite.run("PRAGMA foreign_keys = ON");

// Setting auto_vacuum only takes effect on a fresh database; an existing one
// keeps its stored mode until a full VACUUM rebuilds the file (one-time cost).
const AUTO_VACUUM_INCREMENTAL = 2;
const { auto_vacuum } = sqlite.query("PRAGMA auto_vacuum").get() as {
  auto_vacuum: number;
};
if (auto_vacuum !== AUTO_VACUUM_INCREMENTAL) {
  console.log("[db] Enabling incremental auto_vacuum (running VACUUM once)...");
  sqlite.run("VACUUM");
}

export const db = drizzle(sqlite, { schema });

migrate(db, { migrationsFolder: join(import.meta.dir, "../drizzle") });

/** Returns free pages to the OS and shrinks the WAL file. */
export function reclaimStorage(): void {
  // incremental_vacuum frees pages as it is stepped, so run it to completion.
  sqlite.query("PRAGMA incremental_vacuum").all();
  const { busy } = sqlite.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as {
    busy: number;
  };
  if (busy) {
    console.warn("[db] WAL checkpoint blocked by active readers; WAL not truncated");
  }
}

/**
 * Refreshes planner statistics where they have drifted. Low-cardinality
 * columns like `status` and `is_read` need them to pick the right index.
 */
export function optimizeDatabase(): void {
  sqlite.run("PRAGMA optimize");
}

export function closeDatabase(): void {
  sqlite.close();
}
