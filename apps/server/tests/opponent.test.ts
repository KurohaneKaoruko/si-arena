import { expect, test } from "vitest";
import { clampMatchPage, clampMatchPageLimit } from "@si-arena/protocol";
import { OPPONENT_RATING_WINDOWS, selectOpponent } from "../src/matches/opponent";
import { parsePagination } from "../src/http/pagination";

test("picks the candidate with the smallest absolute rating difference", () => {
  const pick = selectOpponent(
    1000,
    [
      { userId: "far-up", rating: 1300 },
      { userId: "near", rating: 1120 },
      { userId: "far-down", rating: 850 },
    ],
    [],
  );
  expect(pick).toBe("near");
});

test("widens the rating window step by step instead of giving up", () => {
  expect(OPPONENT_RATING_WINDOWS[0]).toBe(250);
  expect(selectOpponent(1000, [], [])).toBeNull();
  expect(selectOpponent(1000, [{ userId: "edge", rating: 1250 }], [])).toBe("edge");
  expect(selectOpponent(1000, [{ userId: "wider", rating: 1400 }], [])).toBe("wider");
  expect(selectOpponent(1000, [{ userId: "far", rating: 3000 }], [])).toBe("far");
  // A narrower window wins even over a recent-free but far candidate set.
  expect(
    selectOpponent(
      1000,
      [
        { userId: "a", rating: 1600 },
        { userId: "b", rating: 1200 },
      ],
      [],
    ),
  ).toBe("b");
});

test("skips every recent opponent while someone else qualifies, at any gap", () => {
  const pick = selectOpponent(
    1000,
    [
      { userId: "recent-1", rating: 1005 },
      { userId: "recent-2", rating: 1001 },
      { userId: "fresh-far", rating: 1900 },
    ],
    ["recent-1", "recent-2"],
  );
  expect(pick).toBe("fresh-far");
});

test("when everyone is recent, only the very last opponent is skipped", () => {
  const candidates = [
    { userId: "last", rating: 1000 },
    { userId: "earlier", rating: 1200 },
  ];
  expect(selectOpponent(1000, candidates, ["last", "earlier"])).toBe("earlier");
  expect(selectOpponent(1000, [{ userId: "last", rating: 1000 }], ["last"])).toBe("last");
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
        [],
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
