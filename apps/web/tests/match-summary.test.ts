import type { MatchSummary } from "@si-arena/protocol";
import { expect, test } from "vitest";
import { matchOutcome, ratingDelta } from "../src/games/match-summary";

const match: MatchSummary = {
  id: "match",
  gameId: "paper",
  status: "completed",
  createdAt: new Date().toISOString(),
  participants: [
    {
      userId: "initiator",
      username: "First",
      official: false,
      slot: 0,
      rank: 2,
      ratingBefore: 1000,
      ratingAfter: 984.123456,
    },
    {
      userId: "opponent",
      username: "Second",
      official: true,
      slot: 1,
      rank: 1,
      ratingBefore: 1000,
      ratingAfter: 1015.876544,
    },
  ],
};

test("results are relative to the current participant, including passive opponents", () => {
  expect(matchOutcome(match, "initiator").label).toBe("失利");
  expect(matchOutcome(match, "opponent").label).toBe("获胜");
  expect(matchOutcome(match, "spectator").label).toBe("已完成");
  expect(ratingDelta(match.participants[0])).toBe("-15.88");
  expect(ratingDelta(match.participants[1])).toBe("+15.88");
});

test("ties, system failure and unsettled matches do not fabricate wins", () => {
  const tied = { ...match, participants: match.participants.map((p) => ({ ...p, rank: 1 })) };
  expect(matchOutcome(tied, "initiator").label).toBe("平局");
  expect(matchOutcome({ ...match, status: "failed" }, "initiator").label).toBe("系统失败");
  expect(matchOutcome({ ...match, status: "pending" }, "opponent").label).toBe("等待开局");
  expect(ratingDelta({ ...match.participants[0]!, ratingAfter: 1000.000001 })).toBe("0.00");
  expect(ratingDelta(undefined)).toBe("—");
});
