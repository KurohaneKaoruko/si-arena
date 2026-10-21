import { randomInt } from "node:crypto";

export interface OpponentCandidate {
  userId: string;
  rating: number;
}

/** Rating windows tried in order; the last one accepts any gap. */
export const OPPONENT_RATING_WINDOWS = [250, 500, 1000, Infinity] as const;
/** Opponents of this many most recent completed ranked matches count as recent. */
export const RECENT_OPPONENT_MATCHES = 5;

/**
 * Picks the ranked opponent among ordinary players (ranked.md "匹配流程"):
 * recent opponents are skipped while anyone else qualifies (only the very last
 * one when everyone is recent), then the smallest rating gap wins inside the
 * narrowest window that has a candidate; equal gaps are broken randomly.
 * Returns null when there is no ordinary candidate at all.
 *
 * @param recentOpponentIds most recent first
 */
export function selectOpponent(
  initiatorRating: number,
  candidates: readonly OpponentCandidate[],
  recentOpponentIds: readonly string[],
): string | null {
  const pool = withoutRecent(candidates, recentOpponentIds);
  for (const window of OPPONENT_RATING_WINDOWS) {
    const inWindow = pool.filter(
      (candidate) => Math.abs(candidate.rating - initiatorRating) <= window,
    );
    if (inWindow.length > 0) return closest(initiatorRating, inWindow);
  }
  return null;
}

function withoutRecent(
  candidates: readonly OpponentCandidate[],
  recentOpponentIds: readonly string[],
): readonly OpponentCandidate[] {
  if (candidates.length <= 1) return candidates;
  const recent = new Set(recentOpponentIds);
  const fresh = candidates.filter((candidate) => !recent.has(candidate.userId));
  if (fresh.length > 0) return fresh;
  const last = recentOpponentIds[0];
  const notLast = candidates.filter((candidate) => candidate.userId !== last);
  return notLast.length > 0 ? notLast : candidates;
}

function closest(initiatorRating: number, pool: readonly OpponentCandidate[]): string {
  let bestDiff = Infinity;
  const tied: OpponentCandidate[] = [];
  for (const candidate of pool) {
    const diff = Math.abs(candidate.rating - initiatorRating);
    if (diff < bestDiff) {
      bestDiff = diff;
      tied.length = 0;
    }
    if (diff === bestDiff) tied.push(candidate);
  }
  const pick = tied[randomInt(0, tied.length)];
  if (pick === undefined) throw new Error("opponent selection pool must not be empty");
  return pick.userId;
}
