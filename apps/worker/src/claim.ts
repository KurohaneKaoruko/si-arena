import { and, eq, or, sql } from "drizzle-orm";
import { matches } from "@si-arena/db";
import type { Executor } from "@si-arena/db";
import type { MatchFailureReason } from "@si-arena/protocol";

/** The lease is short; renewal failures must stop tick dispatch and settlement. */
export const LEASE_MS = 30_000;
export const RENEW_INTERVAL_MS = 5_000;

export type MatchRow = typeof matches.$inferSelect;

/** A row this worker owns: claimed with a fresh lease and execution id. */
export type ClaimedMatch = MatchRow & { executionId: string };

export type ClaimableRelease = { gameId: string; release: string };

/**
 * Claims one pending match in a short transaction: SKIP LOCKED keeps workers
 * from fighting over the same row, and the guarded UPDATE makes the transition
 * to running atomic with the lease and execution id.
 */
export async function claimNextMatch(
  db: Executor,
  claimable: readonly ClaimableRelease[],
): Promise<ClaimedMatch | null> {
  if (claimable.length === 0) return null;
  const pairs = claimable.map((release) =>
    and(eq(matches.gameId, release.gameId), eq(matches.release, release.release)),
  );
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.status, "pending"), or(...pairs)))
      .orderBy(matches.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    const id = rows[0]?.id;
    if (id === undefined) return null;
    const claimed = await tx
      .update(matches)
      .set({
        status: "running",
        leaseExpiresAt: sql`now() + (${LEASE_MS} || ' milliseconds')::interval`,
        executionId: sql`gen_random_uuid()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(matches.id, id), eq(matches.status, "pending")))
      .returning();
    const row = claimed[0];
    if (row === undefined || row.executionId === null) return null;
    return row as ClaimedMatch;
  });
}

/** Extends the lease only while this execution still owns the match. */
export async function renewLease(
  db: Executor,
  matchId: string,
  executionId: string,
): Promise<boolean> {
  const rows = await db
    .update(matches)
    .set({
      leaseExpiresAt: sql`now() + (${LEASE_MS} || ' milliseconds')::interval`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(matches.id, matchId),
        eq(matches.executionId, executionId),
        eq(matches.status, "running"),
      ),
    )
    .returning({ id: matches.id });
  return rows.length > 0;
}

/**
 * Fails running matches whose lease lapsed. Comparing execution ids is not
 * needed here: the current owner keeps renewing, so only abandoned rows match.
 */
export async function failExpiredLeases(db: Executor): Promise<number> {
  const rows = await db
    .update(matches)
    .set({
      status: "failed",
      failureReason: "WORKER_LOST",
      leaseExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(matches.status, "running"), sql`${matches.leaseExpiresAt} < now()`))
    .returning({ id: matches.id });
  return rows.length;
}

/** Terminal failure that keeps rights checking atomic: only the owner succeeds. */
export async function failMatch(
  db: Executor,
  input: { matchId: string; executionId: string; reason: MatchFailureReason },
): Promise<boolean> {
  const rows = await db
    .update(matches)
    .set({
      status: "failed",
      failureReason: input.reason,
      leaseExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(matches.id, input.matchId),
        eq(matches.executionId, input.executionId),
        eq(matches.status, "running"),
      ),
    )
    .returning({ id: matches.id });
  return rows.length > 0;
}
