import { expect, test } from "vitest";
import { router } from "../src/router";

test("only the game workbench locks page scrolling; the arena page scrolls", () => {
  expect(router.resolve("/games/paper").meta.workspace).toBe(true);
  expect(router.resolve("/games/paper/leaderboard").meta.workspace).toBe(true);
  expect(router.resolve("/games/royale/arena").meta.workspace).toBeUndefined();
  expect(router.resolve("/").meta.workspace).toBeUndefined();
});
