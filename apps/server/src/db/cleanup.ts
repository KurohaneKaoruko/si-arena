import { lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { authRateLimits, sessions } from "@si-arena/db";

/** Removes expired sessions and stale rate-limit windows; runs periodically at startup. */
export async function sweepExpiredAuthData(db: NodePgDatabase): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  await db
    .delete(authRateLimits)
    .where(lt(authRateLimits.windowStart, sql`now() - interval '1 hour'`));
}
