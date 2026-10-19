import { expect, test } from "vitest";
import { cloneJson, stringifyJson } from "@si-arena/protocol";
import { ReplayValidationError, replayMatch, runMatch, stateHash } from "../src";
import { fixture, toyGame } from "./helpers";

async function saved() {
  const f = fixture();
  const summary = await runMatch(f.options);
  return { replay: f.sink.replay, summary };
}

test("replay uses stored S0, regenerates events and never initializes or executes a bot", async () => {
  const { replay, summary } = await saved();
  let initialized = false;
  const events: unknown[] = [];
  const game = {
    ...toyGame,
    rules: {
      ...toyGame.rules,
      init() {
        initialized = true;
        throw new Error("Do not initialize a replay");
      },
    },
  };
  expect(
    await replayMatch(replay, game, {
      onTick(frame) {
        events.push(frame.events);
      },
    }),
  ).toEqual(summary);
  expect(initialized).toBe(false);
  expect(events).toEqual([[{ type: "advance" }], [{ type: "advance" }], [{ type: "advance" }]]);
});

const freezeDeep = (node: unknown) => {
  if (node === null || typeof node !== "object") return;
  Object.freeze(node);
  for (const value of Object.values(node)) freezeDeep(value);
};

test("detached replays are validated in place without copying or mutating the snapshot", async () => {
  const { replay, summary } = await saved();
  const detached = cloneJson(replay, 32 * 1024 * 1024);
  expect(await replayMatch(detached, toyGame, { detached: true })).toEqual(summary);
  // Validation must be read-only: even a fully frozen caller snapshot is accepted.
  const frozen = structuredClone(detached);
  freezeDeep(frozen);
  await expect(replayMatch(frozen, toyGame, { detached: true })).resolves.toEqual(summary);
});

test.each([
  [
    "missing active action",
    (r: ReturnType<typeof fixture>["sink"]["replay"]) => {
      delete r.ticks[0]!.actions.a;
    },
  ],
  [
    "extra action",
    (r) => {
      r.ticks[0]!.actions.unknown = { add: 1 };
    },
  ],
  [
    "invalid action",
    (r) => {
      r.ticks[0]!.actions.a = { add: 99 };
    },
  ],
  [
    "missing tick",
    (r) => {
      r.ticks.splice(1, 1);
    },
  ],
  [
    "duplicate tick",
    (r) => {
      r.ticks[1]!.tick = 0;
    },
  ],
  [
    "trailing tick",
    (r) => {
      r.ticks.push({ ...cloneJson(r.ticks[2]!), tick: 3 });
    },
  ],
  [
    "truncated replay",
    (r) => {
      r.ticks.pop();
    },
  ],
  [
    "wrong summary",
    (r) => {
      r.result.players[0]!.score++;
    },
  ],
  [
    "wrong final hash",
    (r) => {
      r.finalStateHash = "0".repeat(64);
    },
  ],
  [
    "changed initial world",
    (r) => {
      r.initialState.total = 50;
    },
  ],
  [
    "nonzero initial tick",
    (r) => {
      r.initialState.tick = 1;
    },
  ],
  [
    "participant slot mismatch",
    (r) => {
      r.players[0]!.id = "intruder";
    },
  ],
  [
    "duplicate participants",
    (r) => {
      r.players[1]!.id = "a";
    },
  ],
  [
    "wrong release",
    (r) => {
      r.game.release = "toy@999";
    },
  ],
  [
    "wrong engine",
    (r) => {
      r.game.engineCompatibility = "unknown";
    },
  ],
  [
    "wrong bot protocol",
    (r) => {
      r.game.botProtocolVersion++;
    },
  ],
  [
    "changed limits",
    (r) => {
      r.resolvedLimits.cpuMs++;
    },
  ],
  [
    "unknown diagnostic player",
    (r) => {
      r.ticks[0]!.errors = { ghost: { type: "RUNTIME_ERROR", message: "oops" } };
    },
  ],
  [
    "extra state snapshot",
    (r) => {
      Object.assign(r.ticks[0]!, { state: r.initialState });
    },
  ],
  [
    "embedded bot source",
    (r) => {
      Object.assign(r, { source: "export default ()=>1" });
    },
  ],
  [
    "invalid log level",
    (r) => {
      r.ticks[0]!.logs = { a: [{ level: "bad" as "log", message: "x" }] };
    },
  ],
  [
    "log line overflow",
    (r) => {
      r.ticks[0]!.logs = { a: [{ level: "log", message: "x".repeat(3000) }] };
    },
  ],
  [
    "negative CPU measurement",
    (r) => {
      r.ticks[0]!.resources = { a: { cpuUsedUs: -1 } };
    },
  ],
  [
    "invalid truncation flag",
    (r) => {
      r.ticks[0]!.logsTruncated = { a: false as true };
    },
  ],
] satisfies Array<[string, (r: ReturnType<typeof fixture>["sink"]["replay"]) => void]>)(
  "rejects %s",
  async (_name, mutate) => {
    const { replay } = await saved();
    mutate(replay);
    await expect(replayMatch(replay, toyGame)).rejects.toBeInstanceOf(ReplayValidationError);
  },
);

test("diagnostics are display data and never replace recorded actions", async () => {
  const { replay, summary } = await saved();
  replay.ticks[0]!.errors = { a: { type: "CPU_LIMIT", message: "display-only" } };
  replay.ticks[0]!.logs = { a: [{ level: "log", message: "debug" }] };
  replay.ticks[0]!.resources = { a: { cpuUsedUs: 999999 } };
  expect(await replayMatch(replay, toyGame)).toEqual(summary);
  for (const tick of replay.ticks) {
    delete tick.errors;
    delete tick.logs;
    delete tick.resources;
  }
  expect(await replayMatch(replay, toyGame)).toEqual(summary);
});

test("canonical SHA-256 sorts UTF-16 keys, preserves arrays and normalizes -0", async () => {
  const a = { z: [2, -0], "\u{10000}": 1, "\ue000": 2, a: { y: 2, x: 1 } };
  const b = { a: { x: 1, y: 2 }, "\ue000": 2, "\u{10000}": 1, z: [2, 0] };
  expect(await stateHash(a)).toBe(await stateHash(b));
  expect(await stateHash({ z: [0, 2] })).not.toBe(await stateHash({ z: [2, 0] }));
  expect(stringifyJson({ "\ue000": 1, "\u{10000}": 2 }, { canonical: true })).toBe('{"𐀀":2,"":1}');
});

test("untrusted JSON, accessor hooks, and oversized files are rejected before rules run", async () => {
  const { replay } = await saved();
  let accessed = false;
  Object.defineProperty(replay, "initialState", {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error("getter");
    },
  });
  await expect(replayMatch(replay, toyGame)).rejects.toThrow("data properties");
  expect(accessed).toBe(false);
  const normal = await saved();
  await expect(replayMatch(normal.replay, toyGame, { maxBytes: 10 })).rejects.toThrow("byte limit");
});
