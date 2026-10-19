import { expect, test } from "vitest";
import { clampMatchPage, clampMatchPageLimit } from "@si-arena/protocol";
import { OPPONENT_RATING_WINDOW, selectOpponent } from "../src/matches/opponent";
import { parsePagination } from "../src/http/pagination";

test("picks the candidate with the smallest absolute rating difference", () => {
  const pick = selectOpponent(
    1000,
    [
      { userId: "far-up", rating: 1300 },
      { userId: "near", rating: 1120 },
      { userId: "far-down", rating: 850 },
    ],
    null,
  );
  expect(pick).toBe("near");
});

test("honors the rating window and returns null without ordinary candidates", () => {
  expect(selectOpponent(1000, [], null)).toBeNull();
  expect(
    selectOpponent(
      1000,
      [{ userId: "edge-plus", rating: 1000 + OPPONENT_RATING_WINDOW + 1 }],
      null,
    ),
  ).toBeNull();
});

test("the window boundary itself still qualifies", () => {
  expect(selectOpponent(1000, [{ userId: "edge", rating: 1250 }], null)).toBe("edge");
  expect(selectOpponent(1000, [{ userId: "edge", rating: 750 }], null)).toBe("edge");
});

test("skips the most recent opponent only when alternatives remain", () => {
  const pick = selectOpponent(
    1000,
    [
      { userId: "recent", rating: 1005 },
      { userId: "other", rating: 1010 },
    ],
    "recent",
  );
  expect(pick).toBe("other");
  expect(selectOpponent(1000, [{ userId: "recent", rating: 1005 }], "recent")).toBe("recent");
});

test("breaks rating ties randomly but only among the closest candidates", () => {
  const picks = new Set<string>();
  for (let i = 0; i < 60; i++) {
    picks.add(
      selectOpponent(
        1000,
        [
          { userId: "tied-up", rating: 1010 },
          { userId: "tied-down", rating: 990 },
          { userId: "far", rating: 1150 },
        ],
        null,
      ) ?? "",
    );
  }
  expect(picks.has("tied-up")).toBe(true);
  expect(picks.has("tied-down")).toBe(true);
  expect(picks.has("far")).toBe(false);
});

test("pagination parsing clamps page and limit", () => {
  expect(parsePagination("/x?page=2&limit=7")).toEqual({ page: 2, limit: 7, offset: 7 });
  expect(parsePagination("/x?page=0&limit=999")).toEqual({ page: 1, limit: 100, offset: 0 });
  expect(parsePagination("/x?page=abc")).toEqual({ page: 1, limit: 50, offset: 0 });
  // Empty parameters fall back to defaults instead of NaN-derived offsets.
  expect(parsePagination("/x?page=&limit=")).toEqual({ page: 1, limit: 50, offset: 0 });
  // The page ceiling keeps (page - 1) * limit inside PostgreSQL's offset range.
  expect(parsePagination("/x?page=1e12&limit=100")).toEqual({
    page: 1_000_000,
    limit: 100,
    offset: 99_999_900,
  });
  expect(clampMatchPage(3.4)).toBe(3);
  expect(clampMatchPage(Number.POSITIVE_INFINITY)).toBe(1);
  expect(clampMatchPageLimit(0)).toBe(1);
});
