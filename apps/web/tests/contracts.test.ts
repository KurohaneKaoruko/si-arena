import { expect, test } from "vitest";
import { paperGame } from "@si-arena/game-paper/game";
import { parseGame, parseGameMe, parseLeaderboard, parseMatch } from "../src/api/contracts";

test("rejects malformed external game, entry, ranking and result responses at the boundary", () => {
  expect(parseGame(paperGame.manifest).id).toBe("paper");
  expect(() => parseGame({ ...paperGame.manifest, resolvedLimits: { cpuMs: -1 } })).toThrow();
  expect(() => parseGameMe({ code: null, canMatch: true })).toThrow();
  expect(() =>
    parseLeaderboard({ page: 1, limit: 20, total: 1, players: [{ rating: "1000" }] }),
  ).toThrow();
  const match = {
    id: "match",
    gameId: "paper",
    status: "completed",
    release: "paper@0.0.0",
    seed: 1,
    initiatorId: "player",
    participants: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  expect(() => parseMatch(match)).toThrow();
  expect(() =>
    parseMatch({
      ...match,
      result: {
        reason: "done",
        completedTicks: 1,
        players: [{ id: "player", rank: 1, score: "bad" }],
      },
    }),
  ).toThrow();
  expect(() =>
    parseMatch({ ...match, status: "failed", failureReason: "arbitrary failure" }),
  ).toThrow();
});
