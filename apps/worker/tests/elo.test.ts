import { describe, expect, test } from "vitest";
import { ELO_K, formatRating, scoreFromRanks, twoPlayerElo } from "../src/elo";

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
