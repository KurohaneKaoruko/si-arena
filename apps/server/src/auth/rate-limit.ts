import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** Counts live in PostgreSQL so every API process shares the same window. */
export const AUTH_RATE_LIMITS = {
  login: { limit: 10, windowMs: 5 * 60_000 },
  register: { limit: 3, windowMs: 60 * 60_000 },
} as const;

export type AuthRateLimitScope = keyof typeof AUTH_RATE_LIMITS;

export function windowStartFor(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export function subjectHashForIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function consumeAuthRateLimit(
  db: NodePgDatabase,
  scope: AuthRateLimitScope,
  ip: string,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const { limit, windowMs } = AUTH_RATE_LIMITS[scope];
  const windowStart = windowStartFor(now, windowMs);
  const windowEndMs = windowStart.getTime() + windowMs;
  const result = await db.execute(sql`
    INSERT INTO auth_rate_limits (scope, subject_hash, window_start, count)
    VALUES (${scope}, ${subjectHashForIp(ip)}, ${windowStart}, 1)
    ON CONFLICT (scope, subject_hash, window_start)
    DO UPDATE SET count = auth_rate_limits.count + 1
    RETURNING count
  `);
  const count = Number((result.rows[0] as { count: number } | undefined)?.count ?? 1);
  return {
    allowed: count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((windowEndMs - now.getTime()) / 1000)),
  };
}
