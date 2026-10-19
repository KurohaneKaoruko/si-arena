import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { gameEntries, matchParticipants, matches } from "@si-arena/db";
import type { Executor } from "@si-arena/db";
import type { GameResult } from "@si-arena/protocol";
import { formatRating, scoreFromRanks, twoPlayerElo } from "./elo";
import type { ReplayStore } from "./replay-store";

export type SettleOutcome = "completed" | "refused";

export interface SettleInput {
  matchId: string;
  executionId: string;
  result: GameResult;
  /** Measured on the saved candidate before this call. */
  replayFile: { fileName: string; formatVersion: 1; bytes: number; sha256: string };
  candidatePath: string;
}

function rankByUserId(result: GameResult): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const player of result.players) {
    if (!Number.isSafeInteger(player.rank)) {
      throw new Error("Match result is missing an integral rank for every player");
    }
    ranks.set(player.id, player.rank);
  }
  return ranks;
}

/**
 * Publishes a finished match: one transaction verifies execution rights, locks
 * both rating rows in a stable order, applies Elo, links the replay candidate
 * to its public name, and commits the terminal state. Refusal leaves every row
 * and file untouched — a stale worker can never overwrite a valid settlement.
 */
export async function settleMatch(
  db: Executor,
  store: ReplayStore,
  input: SettleInput,
): Promise<SettleOutcome> {
  return db.transaction(async (tx) => {
    const matchRows = await tx
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.id, input.matchId),
          eq(matches.status, "running"),
          eq(matches.executionId, input.executionId),
          gt(matches.leaseExpiresAt, sql`now()`),
          isNull(matches.result),
          isNull(matches.replayFile),
        ),
      )
      .limit(1)
      .for("update");
    const match = matchRows[0];
    if (match === undefined) return "refused";

    const seats = await tx
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.matchId, input.matchId))
      .orderBy(asc(matchParticipants.slot));
    if (seats.length !== 2) throw new Error("Match must settle exactly two participants");
    const ranks = rankByUserId(input.result);
    for (const seat of seats) {
      if (!ranks.has(seat.userId)) throw new Error("Match result is missing a participant rank");
    }

    // Stable lock order by user id keeps concurrent settlements deadlock-free.
    const orderedUserIds = seats.map((seat) => seat.userId).toSorted();
    const entries = await tx
      .select()
      .from(gameEntries)
      .where(and(eq(gameEntries.gameId, match.gameId), inArray(gameEntries.userId, orderedUserIds)))
      .orderBy(asc(gameEntries.userId))
      .for("update");
    const entryByUser = new Map(entries.map((entry) => [entry.userId, entry]));
    for (const userId of orderedUserIds) {
      if (!entryByUser.has(userId)) throw new Error("Participant lost their game entry");
    }

    const seatA = seats[0]!;
    const seatB = seats[1]!;
    const ratingA = Number(entryByUser.get(seatA.userId)!.rating);
    const ratingB = Number(entryByUser.get(seatB.userId)!.rating);
    const scoreA = scoreFromRanks(ranks.get(seatA.userId)!, ranks.get(seatB.userId)!);
    const { deltaA, deltaB } = twoPlayerElo(ratingA, ratingB, scoreA);
    const deltas = [deltaA, deltaB];
    const ratingsBefore = [ratingA, ratingB];

    for (const [index, seat] of seats.entries()) {
      const entry = entryByUser.get(seat.userId)!;
      const ratingAfter = ratingsBefore[index]! + deltas[index]!;
      const score = index === 0 ? scoreA : 1 - scoreA;
      await tx
        .update(gameEntries)
        .set({
          rating: formatRating(ratingAfter),
          matchesPlayed: entry.matchesPlayed + 1,
          wins: entry.wins + (score === 1 ? 1 : 0),
          draws: entry.draws + (score === 0.5 ? 1 : 0),
          losses: entry.losses + (score === 0 ? 1 : 0),
          updatedAt: sql`now()`,
        })
        .where(eq(gameEntries.id, entry.id));
      await tx
        .update(matchParticipants)
        .set({
          rank: ranks.get(seat.userId)!,
          ratingBefore: formatRating(ratingsBefore[index]!),
          ratingAfter: formatRating(ratingAfter),
        })
        .where(eq(matchParticipants.id, seat.id));
    }

    await store.publish(input.candidatePath, input.matchId);
    await tx
      .update(matches)
      .set({
        status: "completed",
        result: input.result,
        replayFile: input.replayFile,
        leaseExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(matches.id, input.matchId),
          eq(matches.executionId, input.executionId),
          eq(matches.status, "running"),
        ),
      );
    return "completed";
  });
}
