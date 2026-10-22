import { describe, expect, test } from "vitest";
import { ELO_K, formatRating, pairwiseElo, scoreFromRanks, twoPlayerElo } from "../src/elo";

describe("twoPlayerElo", () => {
  test("equal ratings split K exactly on win, draw, and loss", () => {
    expect(twoPlayerElo(1000, 1000, 1)).toEqual({ deltaA: ELO_K / 2, deltaB: -ELO_K / 2 });
    expect(twoPlayerElo(1000, 1000, 0.5)).toEqual({ deltaA: 0, deltaB: 0 });
    expect(twoPlayerElo(1000, 1000, 0)).toEqual({ deltaA: -ELO_K / 2, deltaB: ELO_K / 2 });
  });

  test("favourites gain less than underdogs and deltas always sum to zero", () => {
    const favourite = twoPlayerElo(1200, 1000, 1);
    const underdog = twoPlayerElo(1000, 1200, 1);
    expect(favourite.deltaA).toBeGreaterThan(0);
    expect(favourite.deltaA).toBeLessThan(ELO_K / 2);
    expect(underdog.deltaA).toBeGreaterThan(ELO_K / 2);
    for (const { deltaA, deltaB } of [favourite, underdog, twoPlayerElo(1077, 923, 0.5)]) {
      expect(formatRating(deltaA + deltaB)).toBe("0.000000");
    }
  });

  test("rounds A to six decimals and mirrors the exact value to B", () => {
    // 1600 vs 1400 with a draw produces a repeating decimal.
    const { deltaA, deltaB } = twoPlayerElo(1600, 1400, 0.5);
    expect(deltaA).toBe(-Math.abs(deltaA));
    expect(Number.isInteger(deltaA * 1e6)).toBe(true);
    expect(deltaB).toBe(-deltaA);
  });

  test("extreme gaps stay inside the K bound", () => {
    const crushed = twoPlayerElo(2400, 1000, 0);
    expect(crushed.deltaA).toBeGreaterThanOrEqual(-ELO_K);
    const flawless = twoPlayerElo(1000, 2400, 1);
    expect(flawless.deltaA).toBeLessThanOrEqual(ELO_K);
  });
});

test("scoreFromRanks maps smaller rank to a win and equal ranks to a draw", () => {
  expect(scoreFromRanks(1, 2)).toBe(1);
  expect(scoreFromRanks(2, 1)).toBe(0);
  expect(scoreFromRanks(1, 1)).toBe(0.5);
});

describe("pairwiseElo", () => {
  test("two scored players settle exactly like a duel with full K", () => {
    const [winner, loser] = pairwiseElo([1000, 1000], [1, 2]);
    expect(winner).toBe(ELO_K / 2);
    expect(loser).toBe(-ELO_K / 2);
  });

  test("splits K across n-1 pairs so every player swings within K", () => {
    // Five equal-rated players in strict rank order.
    const deltas = pairwiseElo([1000, 1000, 1000, 1000, 1000], [1, 2, 3, 4, 5]);
    expect(deltas[0]).toBe(ELO_K / 2);
    expect(deltas[4]).toBe(-ELO_K / 2);
    expect(deltas[2]).toBe(0);
    for (const delta of deltas) {
      expect(Math.abs(delta)).toBeLessThanOrEqual(ELO_K);
      // Accumulated pair halves carry float dust; only the 6-decimal value is exact.
      expect(Math.abs(delta * 1e6 - Math.round(delta * 1e6))).toBeLessThan(1e-6);
    }
    expect(formatRating(deltas.reduce((sum, delta) => sum + delta, 0))).toBe("0.000000");
  });

  test("equal ranks draw every pair; equal ratings then stay untouched", () => {
    expect(pairwiseElo([1000, 1000, 1000], [2, 2, 2])).toEqual([0, 0, 0]);
    // Draws between unequal ratings still converge toward the underdog.
    const deltas = pairwiseElo([900, 1100, 1200], [2, 2, 2]);
    expect(deltas[0]).toBeGreaterThan(0);
    expect(deltas[2]).toBeLessThan(0);
    expect(formatRating(deltas.reduce((sum, delta) => sum + delta, 0))).toBe("0.000000");
  });

  test("favourites gain less against the field and underdogs lose less", () => {
    const ratings = [1600, 1000, 1000, 1000];
    const champion = pairwiseElo(ratings, [1, 2, 3, 4])[0]!;
    const upset = pairwiseElo(ratings, [4, 1, 2, 3])[0]!;
    expect(champion).toBeGreaterThan(0);
    expect(champion).toBeLessThan(ELO_K / 2);
    expect(upset).toBeLessThan(-ELO_K / 2);
    expect(upset).toBeGreaterThanOrEqual(-ELO_K);
  });

  test("fewer than two scored players keep their ratings", () => {
    expect(pairwiseElo([], [])).toEqual([]);
    expect(pairwiseElo([1000], [1])).toEqual([0]);
  });

  test("requires one rank per rating", () => {
    expect(() => pairwiseElo([1000, 1000], [1])).toThrow();
  });
});
