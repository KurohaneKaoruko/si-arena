import { randomInt } from "node:crypto";

export interface OpponentCandidate {
  userId: string;
  rating: number;
}

export const OPPONENT_RATING_WINDOW = 250;

/**
 * Picks the opponent for an initiated match: ordinary players within the rating
 * window, preferring the smallest absolute difference (ties broken randomly).
 * The most recent completed opponent is skipped whenever another candidate
 * remains. Returns null when no ordinary candidate qualifies; the caller then
 * falls back to the official account, which ignores the rating window.
 */
export function selectOpponent(
  initiatorRating: number,
  candidates: readonly OpponentCandidate[],
  recentOpponentId: string | null,
): string | null {
  const qualified = candidates.filter(
    (candidate) => Math.abs(candidate.rating - initiatorRating) <= OPPONENT_RATING_WINDOW,
  );
  let pool = qualified;
  if (qualified.length > 1 && recentOpponentId !== null) {
    const withoutRecent = qualified.filter((candidate) => candidate.userId !== recentOpponentId);
    if (withoutRecent.length > 0) pool = withoutRecent;
  }
  if (pool.length === 0) return null;
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
