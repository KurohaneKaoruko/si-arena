import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** Counts live in PostgreSQL so every API process shares the same window. */
export const AUTH_RATE_LIMITS = {
  login: { limit: 10, windowMs: 5 * 60_000 },
  // Only successful sign-ups count, so typos and taken names never lock anyone out.
  register: { limit: 10, windowMs: 60 * 60_000 },
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

function decide(count: number, limit: number, windowEndMs: number, now: Date): RateLimitDecision {
  return {
    allowed: count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((windowEndMs - now.getTime()) / 1000)),
  };
}

/** Reads the window without counting this request; pair with consume once it succeeds. */
export async function checkAuthRateLimit(
  db: NodePgDatabase,
  scope: AuthRateLimitScope,
  ip: string,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const { limit, windowMs } = AUTH_RATE_LIMITS[scope];
  const windowStart = windowStartFor(now, windowMs);
  const result = await db.execute(sql`
    SELECT count FROM auth_rate_limits
    WHERE scope = ${scope} AND subject_hash = ${subjectHashForIp(ip)} AND window_start = ${windowStart}
  `);
  const count = Number((result.rows[0] as { count: number } | undefined)?.count ?? 0);
  return decide(count + 1, limit, windowStart.getTime() + windowMs, now);
}

export async function consumeAuthRateLimit(
  db: NodePgDatabase,
  scope: AuthRateLimitScope,
  ip: string,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const { limit, windowMs } = AUTH_RATE_LIMITS[scope];
  const windowStart = windowStartFor(now, windowMs);
  const result = await db.execute(sql`
    INSERT INTO auth_rate_limits (scope, subject_hash, window_start, count)
    VALUES (${scope}, ${subjectHashForIp(ip)}, ${windowStart}, 1)
    ON CONFLICT (scope, subject_hash, window_start)
    DO UPDATE SET count = auth_rate_limits.count + 1
    RETURNING count
  `);
  const count = Number((result.rows[0] as { count: number } | undefined)?.count ?? 1);
  return decide(count, limit, windowStart.getTime() + windowMs, now);
}
