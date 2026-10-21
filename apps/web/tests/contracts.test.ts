import { expect, test } from "vitest";
import { paperGame } from "@si-arena/game-paper/game";
import {
  parseArenaStatus,
  parseGame,
  parseGameMe,
  parseLeaderboard,
  parseMatch,
} from "../src/api/contracts";

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
    kind: "ranked",
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

test("entry responses validate active initiated matches independently from code eligibility", () => {
  const me = {
    entry: { rating: 1000, matchesPlayed: 0, wins: 0, draws: 0, losses: 0 },
    boss: { available: true, attempts: 2, wins: 1 },
    code: null,
    canMatch: false,
    cannotMatchReason: "NO_CODE",
    activeMatch: null,
  };
  expect(parseGameMe(me).activeMatch).toBeNull();
  expect(
    parseGameMe({ ...me, activeMatch: { id: "active", status: "running" } }).activeMatch?.id,
  ).toBe("active");
  expect(() => parseGameMe({ ...me, activeMatch: { id: "done", status: "completed" } })).toThrow();
  expect(() => parseGameMe({ ...me, activeMatch: { status: "pending" } })).toThrow();
});

test("match kinds, boss flags, arena points and arena status are validated strictly", () => {
  const now = new Date().toISOString();
  const player = { userId: "p", username: "P", official: false, boss: false, slot: 0 };
  const match = {
    id: "m",
    gameId: "royale",
    kind: "arena",
    status: "failed",
    release: "royale@0.1.0",
    seed: 1,
    initiatorId: "p",
    participants: [player],
    createdAt: now,
    updatedAt: now,
  };
  expect(parseMatch(match).kind).toBe("arena");
  expect(() => parseMatch({ ...match, kind: "friendly" })).toThrow();
  expect(() => parseMatch({ ...match, participants: [{ ...player, boss: undefined }] })).toThrow();
  const row = {
    rank: 1,
    userId: "p",
    username: "P",
    official: false,
    rating: 1000,
    matchesPlayed: 2,
    wins: 1,
    draws: 0,
    losses: 1,
    points: 16,
    placementTotal: 3,
  };
  expect(
    parseLeaderboard({ page: 1, limit: 20, total: 1, players: [row] }).players[0]!.points,
  ).toBe(16);
  expect(() =>
    parseLeaderboard({ page: 1, limit: 20, total: 1, players: [{ ...row, points: undefined }] }),
  ).toThrow();
  const lineup = { ...row, codeUpdatedAt: now };
  expect(parseArenaStatus({ active: null, lineup: [lineup], recent: [match] }).recent).toHaveLength(
    1,
  );
  expect(() => parseArenaStatus({ active: null, lineup: [lineup] })).toThrow();
  expect(() =>
    parseArenaStatus({ active: { ...match, kind: 1 }, lineup: [], recent: [] }),
  ).toThrow();
  const arena = { seats: 5, keepMatches: 3, points: [10, 6, 3, 1, 0] };
  expect(parseGame({ ...paperGame.manifest, arena }).arena?.seats).toBe(5);
  expect(() => parseGame({ ...paperGame.manifest, arena: { ...arena, points: ["10"] } })).toThrow();
  expect(() =>
    parseGameMe({
      entry: { rating: 1000, matchesPlayed: 0, wins: 0, draws: 0, losses: 0 },
      code: null,
      canMatch: false,
      cannotMatchReason: "NO_CODE",
      activeMatch: null,
    }),
  ).toThrow();
});
