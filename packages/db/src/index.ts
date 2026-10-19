import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Pool } from "pg";

export * from "./schema";

/** Accepted by helpers that run on either the pool database or an open transaction. */
export type Executor = PgDatabase<NodePgQueryResultHKT>;

/**
 * Drizzle migrations ship inside the package, so server and worker tests apply
 * the same folder the db:generate / db:migrate scripts use.
 */
export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Create connections explicitly; importing this module never contacts PostgreSQL. */
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10 });
  return { db: drizzle(pool), close: () => pool.end() };
}
