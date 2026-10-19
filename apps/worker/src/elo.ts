export const ELO_K = 32;

/** numeric(12,6) stores exactly six decimal places. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Two-player Elo with zero-sum deltas: A's change is rounded to six decimals
 * first, then B receives the exact opposite so each settlement sums to zero.
 */
export function twoPlayerElo(
  ratingA: number,
  ratingB: number,
  scoreA: number,
): { deltaA: number; deltaB: number } {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  const deltaA = round6(ELO_K * (scoreA - expectedA));
  // Avoid -0 so serialized deltas stay canonical.
  const deltaB = deltaA === 0 ? 0 : -deltaA;
  return { deltaA, deltaB };
}

/** Slot A's score from final ranks: the smaller rank wins, equal ranks draw. */
export function scoreFromRanks(rankA: number, rankB: number): number {
  if (rankA < rankB) return 1;
  if (rankA === rankB) return 0.5;
  return 0;
}

/** Fixed-point serialization for numeric(12,6) columns. */
export function formatRating(value: number): string {
  return value.toFixed(6);
}
