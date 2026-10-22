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
  k: number = ELO_K,
): { deltaA: number; deltaB: number } {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  const deltaA = round6(k * (scoreA - expectedA));
  // Avoid -0 so serialized deltas stay canonical.
  const deltaB = deltaA === 0 ? 0 : -deltaA;
  return { deltaA, deltaB };
}

/**
 * Multi-player Elo over one match's final ranks: every unordered pair of the
 * scored players is a win/draw/loss by rank, each pair uses K/(n-1) so a
 * player's total swing stays within K, and equal ranks draw. Players below two
 * have no pairs and keep their ratings.
 */
export function pairwiseElo(ratings: number[], ranks: number[]): number[] {
  if (ratings.length !== ranks.length) throw new Error("pairwiseElo needs one rank per rating");
  const deltas = ratings.map(() => 0);
  const pairK = ELO_K / Math.max(1, ratings.length - 1);
  for (let i = 0; i < ratings.length; i++) {
    for (let j = i + 1; j < ratings.length; j++) {
      const { deltaA, deltaB } = twoPlayerElo(
        ratings[i]!,
        ratings[j]!,
        scoreFromRanks(ranks[i]!, ranks[j]!),
        pairK,
      );
      deltas[i]! += deltaA;
      deltas[j]! += deltaB;
    }
  }
  // Pair halves are exact opposites, so re-rounding only sheds float dust.
  return deltas.map(round6);
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
