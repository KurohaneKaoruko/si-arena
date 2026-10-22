import type { BomberEvent } from "@si-arena/game-bomber/sdk";
import { expect, test } from "vitest";
import { cloneJson, snapshotJson } from "@si-arena/protocol";
import { bomberManifest } from "@si-arena/game-bomber";
import { bomberGame } from "@si-arena/game-bomber/game";
import type { BomberObservation, BomberState } from "@si-arena/game-bomber/sdk";
import {
  parseBomberAction,
  parseBomberObservation,
  parseBomberState,
  bomberRules,
} from "@si-arena/game-bomber/rules";
import {
  IDS,
  actions,
  bomb,
  deepFreeze,
  eliminate,
  idle,
  index,
  init,
  move,
  placeBomb,
  powerup,
  randomActions,
  required,
  step,
  wall,
  world,
} from "./helpers";

const context = (state: BomberState, playerId = "alpha") => ({
  config: { ...bomberManifest.config },
  players: state.players.map(({ id, slot }) => ({ id, slot })),
  playerId,
  tick: state.tick,
});

test("the manifest publishes the arena and default limits", () => {
  expect(bomberManifest).toMatchObject({
    id: "bomber",
    release: "bomber@0.1.0",
    botProtocolVersion: 1,
    minPlayers: 2,
    maxPlayers: 4,
    maxTicks: 400,
    arena: { seats: 4, keepMatches: 3, tieBreakGameId: "paper" },
  });
  expect(bomberGame.manifest.resolvedLimits.cpuMs).toBe(20);
  expect(bomberGame.parseConfig(cloneJson(bomberManifest.config))).toStrictEqual(
    bomberManifest.config,
  );
  expect(() => bomberGame.parseConfig({ ...bomberManifest.config, bombFuse: 5 })).toThrow();
  expect(() => bomberGame.parseConfig({ ...bomberManifest.config, extra: 1 })).toThrow();
});

const initInput = () => ({
  seed: 2,
  config: { ...bomberManifest.config },
  players: IDS.slice(0, 3).map((id, slot) => ({ id, slot })),
});

test("initialization rejects bad seeds, configs, player counts, duplicate identities and slots", () => {
  for (const seed of [-1, 2 ** 32, 1.5, NaN, "2", null])
    expect(() => bomberRules.init({ ...initInput(), seed } as never)).toThrow();
  expect(() => bomberRules.init({ ...initInput(), config: { width: 15 } })).toThrow();
  for (const players of [
    [{ id: "a", slot: 0 }],
    [...IDS, "epsilon"].map((id, slot) => ({ id, slot })),
    [
      { id: "a", slot: 0 },
      { id: "a", slot: 1 },
    ],
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 0 },
    ],
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 2 },
    ],
    [
      { id: "", slot: 0 },
      { id: "b", slot: 1 },
    ],
  ])
    expect(() => bomberRules.init({ ...initInput(), players })).toThrow();
  const reversed = { ...initInput(), players: initInput().players.toReversed() };
  expect(bomberRules.init(deepFreeze(reversed))).toStrictEqual(init(3));
});

test("actions have an exact schema", () => {
  for (const action of [idle(), bomb(), ...(["up", "right", "down", "left"] as const).map(move)])
    expect(parseBomberAction(deepFreeze(action))).toStrictEqual({ ok: true, action });
  for (const raw of [
    null,
    "idle",
    {},
    { type: "idle", direction: "up" },
    { type: "bomb", direction: "up" },
    { type: "move" },
    { type: "move", direction: "UP" },
    { type: "move", direction: "left", extra: 1 },
    Object.create({ type: "idle" }),
  ])
    expect(parseBomberAction(raw).ok).toBe(false);
});

test("step requires exactly the living players' canonical actions", () => {
  const state = eliminate(init(3), 2);
  for (const raw of [
    {},
    { alpha: idle() },
    { alpha: idle(), beta: idle(), gamma: idle() },
    { alpha: idle(), beta: { type: "move", direction: "oops" } },
  ])
    expect(() => bomberRules.step(state, raw as never)).toThrow();
  const input = actions(state, { 0: bomb(), 1: move("up") });
  const reversed = Object.fromEntries(Object.entries(input).toReversed());
  expect(bomberRules.step(state, input)).toStrictEqual(bomberRules.step(state, reversed));
});

/** Three players, one bomb each, a wall with an item and a powerup on the ground. */
const base = () => {
  const state = world([
    [0, 0],
    [14, 12],
    [0, 12],
  ]);
  wall(state, [4, 0], 2);
  placeBomb(state, 1, [12, 12], 3, 2);
  powerup(state, [2, 0], "fire");
  return state;
};

test("state validation rejects malformed or inconsistent worlds", () => {
  type Loose = BomberState & Record<string, unknown>;
  const corruptions: Array<(state: Loose) => void> = [
    (s) => void (s.width = 14 as never),
    (s) => void (s.maxTicks = 500 as never),
    (s) => void (s.tick = 401),
    (s) => void (s.rngState = 0),
    (s) => void (s.extra = 1),
    (s) => void s.cells.pop(),
    (s) => void (s.cells[2] = 4),
    (s) => void (s.cells[2] = 1),
    (s) => void (s.cells[index(s, [1, 1])] = 0),
    (s) => void (s.cells[2] = 3),
    (s) => void (s.hidden[2] = 1),
    (s) => void (s.hidden[index(s, [4, 0])] = 3),
    (s) => void s.hidden.pop(),
    (s) => void (s.players = s.players.toReversed()),
    (s) => void (s.players[1]!.id = "alpha"),
    (s) => void (s.players[0]!.position = null),
    (s) => void (s.players[0]!.position = { x: 1, y: 1 }),
    (s) => void (s.players[0]!.position = { x: 4, y: 0 }),
    (s) => void (s.players[0]!.position = { x: 2, y: 0 }),
    (s) => void (s.players[0]!.death = { tick: 0, causes: ["flame"] }),
    (s) => {
      eliminate(s, 2, 1);
      s.players[2]!.death = { tick: 1, causes: ["collapse", "flame"] };
    },
    (s) => {
      eliminate(s, 2, 1);
      s.players[2]!.score = 5;
    },
    (s) => void (s.players[0]!.bombsMax = 7),
    (s) => void (s.players[0]!.fireRange = 1),
    (s) => void (s.bombs[0]!.fuse = 8),
    (s) => void (s.bombs[0]!.fuse = 0),
    (s) => void (s.bombs[0]!.range = 1),
    (s) => void (s.bombs[0]!.owner = 3),
    (s) => void (s.bombs[0]!.position = { x: 4, y: 0 }),
    (s) => void (s.bombs[0]!.position = { x: 2, y: 0 }),
    (s) => void s.bombs.push({ ...s.bombs[0]!, position: { x: 13, y: 12 } }),
    (s) => void s.bombs.push({ ...s.bombs[0]!, owner: 0, position: { x: 12, y: 12 } }),
    (s) => void (s.powerups[0]!.kind = "x" as never),
    (s) => void s.powerups.push({ position: { x: 2, y: 0 }, kind: "bomb" }),
    (s) => {
      s.tick = 300;
    },
  ];
  expect(parseBomberState(base())).toStrictEqual(base());
  for (const [number, corrupt] of corruptions.entries()) {
    const state = base() as Loose;
    corrupt(state);
    expect(() => parseBomberState(state), `corruption ${number}`).toThrow();
  }
  const state = init(3);
  expect(() =>
    bomberGame.parseState(state, {
      ...context(state),
      players: context(state).players.slice(0, 2),
    }),
  ).toThrow();
  expect(() =>
    bomberGame.parseState(state, {
      ...context(state),
      players: context(state).players.map((p, i) => ({ ...p, id: IDS[(i + 1) % 3]! })),
    }),
  ).toThrow();
});

test("observations are public copies with the living, the eliminated and the collapse schedule", () => {
  const state = deepFreeze(eliminate(base(), 2, 1));
  const observation = required(bomberRules.observe(state, "beta"));
  expect(observation).toMatchObject({
    tick: 1,
    maxTicks: 400,
    selfId: "beta",
    selfSlot: 1,
    collapse: { startTick: 300, interval: 8, nextRing: 0, ticksToNextCollapse: 299 },
    bombs: [{ position: { x: 12, y: 12 }, owner: 1, fuse: 3, range: 2 }],
    powerups: [{ position: { x: 2, y: 0 }, kind: "fire" }],
    eliminated: [{ id: "gamma", slot: 2, tick: 1, causes: ["flame"] }],
    events: [],
  });
  expect(observation.players.map((p) => [p.id, p.slot, p.activeBombs])).toStrictEqual([
    ["alpha", 0, 0],
    ["beta", 1, 1],
  ]);
  expect(observation).not.toHaveProperty("rngState");
  expect(observation.board).not.toHaveProperty("hidden");
  expect(observation.players[0]).not.toHaveProperty("death");
  observation.board.cells[2] = 2;
  expect(state.cells[2]).toBe(0);
  expect(bomberRules.observe(state, "gamma")).toBe(null);
  expect(() => bomberRules.observe(state, "nobody")).toThrow(/Unknown/);
  expect(bomberRules.defaultAction(state, "alpha")).toStrictEqual(idle());
});

test("observation validation checks identity, seats, bombs, collapse and events", () => {
  const state = eliminate(base(), 2, 1);
  const before = step(state, { 0: move("right") });
  const raw = required(bomberRules.observe(before.nextState, "alpha", { events: before.events }));
  const ctx = context(before.nextState);
  expect(bomberGame.parseObservation(raw, ctx)).toStrictEqual(raw);
  const at = { x: 1, y: 0 };
  const corruptions: Array<(o: BomberObservation) => void> = [
    (o) => void (o.selfSlot = 1),
    (o) => void (o.tick = 3),
    (o) => void (o.players[1]!.activeBombs = 0),
    (o) => void (o.players[0]!.id = "gamma"),
    (o) => void (o.players[1]!.slot = 2),
    (o) => void (o.collapse.nextRing = 1),
    (o) => void (o.collapse.ticksToNextCollapse = null),
    (o) => void (o.eliminated[0]!.tick = 5),
    (o) => void o.eliminated.pop(),
    (o) => void (o.board.cells[1] = 2),
    (o) => void (o.bombs[0]!.fuse = 8),
    (o) => void (o.powerups[0]!.position = { x: 12, y: 12 }),
    (o) => void (o.events = [{ type: "move", playerId: "nobody", from: at, to: at }]),
    (o) =>
      void (o.events = [
        {
          type: "explosion",
          bombs: [{ position: at, ownerId: "alpha" }],
          cells: [3, 2],
          destroyed: [],
        },
      ]),
    (o) => void (o.events = [{ type: "explosion", bombs: [], cells: [2], destroyed: [] }]),
    (o) => void (o.events = [{ type: "collapse", ring: 6, cells: [0] }]),
    (o) =>
      void (o.events = [
        { type: "death", playerId: "gamma", position: at, causes: [], killerIds: [] },
      ]),
    (o) =>
      void (o.events = [
        { type: "death", playerId: "gamma", position: at, causes: ["flame"], killerIds: ["gamma"] },
      ]),
    (o) =>
      void (o.events = [
        {
          type: "death",
          playerId: "gamma",
          position: at,
          causes: ["flame"],
          killerIds: ["beta", "alpha"],
        },
      ]),
    (o) =>
      void (o.events = [{ type: "pickup", playerId: "alpha", kind: "x" as never, position: at }]),
  ];
  for (const [number, corrupt] of corruptions.entries()) {
    const copy = cloneJson(raw);
    corrupt(copy);
    expect(() => bomberGame.parseObservation(copy, ctx), `corruption ${number}`).toThrow();
  }
  expect(() => bomberGame.parseObservation(raw, { ...ctx, playerId: "beta" })).toThrow();
  expect(() => bomberGame.parseObservation({ ...raw, rngState: 1 }, ctx)).toThrow();
  const first = required(bomberRules.observe(init(3), "alpha"));
  expect(() => parseBomberObservation({ ...first, events: before.events })).toThrow();
});

test("engine snapshots share validated grids read-only", () => {
  const snapshot = snapshotJson(init(4));
  const observation = required(bomberRules.observe(snapshot, "delta"));
  expect(observation.board.cells).toBe(snapshot.cells);
  const ctx = context(init(4), "delta");
  const parsed = bomberGame.parseObservation(snapshotJson(observation), ctx);
  expect(parsed.board.cells).toBe(snapshot.cells);
  expect(bomberGame.parseState(snapshot, ctx).cells).toBe(snapshot.cells);
  expect(bomberGame.parseState(snapshot, ctx).hidden).toBe(snapshot.hidden);
  expect(parseBomberState(snapshot).cells).not.toBe(snapshot.cells);
  const invalid = init(4);
  invalid.cells[0] = 7;
  expect(() => bomberRules.observe(snapshotJson(invalid), "alpha")).toThrow();
});

test("rules never read host randomness or wall time", () => {
  const random = Math.random;
  const now = Date.now;
  try {
    Math.random = () => {
      throw new Error("Host randomness is forbidden");
    };
    Date.now = () => {
      throw new Error("Wall time is forbidden");
    };
    expect(step(init(4, 0), { 0: bomb() }).nextState.tick).toBe(1);
  } finally {
    Math.random = random;
    Date.now = now;
  }
});

test("generated games stay valid and replay identically from JSON records", () => {
  const reasons = new Set<string>();
  for (const players of [2, 3, 4]) {
    for (let seed = 1; seed <= 4; seed++) {
      const initial = init(players, seed);
      const pick = randomActions(seed * 7 + players);
      const records: Record<string, unknown>[] = [];
      let state = initial;
      for (;;) {
        const input = pick(state);
        records.push(input);
        const output = bomberRules.step(state, input);
        expect(() => parseBomberState(output.nextState)).not.toThrow();
        state = output.nextState;
        if (output.result) {
          reasons.add(output.result.reason);
          break;
        }
      }
      let replayed = JSON.parse(JSON.stringify(initial)) as BomberState;
      for (const input of JSON.parse(JSON.stringify(records)) as never[])
        replayed = bomberRules.step(replayed, input).nextState;
      expect(replayed).toStrictEqual(state);
      expect(state.rngState, "step does not draw random numbers").toBe(initial.rngState);
    }
  }
  expect(reasons.has("elimination"), "random bombers blow each other up").toBe(true);
}, 30000);

test("shared immutable observation validation still checks identity and changed common fields", () => {
  const state = snapshotJson(init());
  const observations = state.players.map((player) =>
    snapshotJson(bomberRules.observe(state, player.id)!),
  );
  const first = observations[0]!;
  expect(observations[1]!.board).toBe(first.board);
  for (const observation of observations)
    expect(parseBomberObservation(observation).selfId).toBe(observation.selfId);
  expect(() =>
    parseBomberObservation(snapshotJson({ ...observations[1], selfId: first.selfId })),
  ).toThrow(/identity/);
  const collapse = { ...first.collapse, nextRing: 3 };
  expect(() => parseBomberObservation(snapshotJson({ ...first, collapse }))).toThrow();
  const players = first.players.map((player, i) => ({
    ...player,
    activeBombs: i === 0 ? 1 : player.activeBombs,
  }));
  expect(() => parseBomberObservation(snapshotJson({ ...first, players }))).toThrow();
});

test("mutable previous events cannot reuse an immutable world's cached observation", () => {
  const state = snapshotJson(init());
  const events: BomberEvent[] = [];
  bomberRules.observe(state, "alpha", { events });
  events.push({ type: "collapse", ring: 0, cells: [] });
  expect(() => bomberRules.observe(state, "beta", { events })).toThrow();
});
