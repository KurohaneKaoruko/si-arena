import type { RoyaleEvent } from "@si-arena/game-royale/sdk";
import { expect, test } from "vitest";
import { cloneJson, snapshotJson } from "@si-arena/protocol";
import { royaleManifest } from "@si-arena/game-royale";
import { royaleGame } from "@si-arena/game-royale/game";
import type { RoyaleObservation, RoyaleState } from "@si-arena/game-royale/sdk";
import {
  parseRoyaleAction,
  parseRoyaleObservation,
  parseRoyaleState,
  royaleRules,
} from "@si-arena/game-royale/rules";
import {
  IDS,
  actions,
  deepFreeze,
  eliminate,
  excursion,
  idle,
  index,
  init,
  move,
  randomActions,
  required,
  step,
  world,
} from "./helpers";

const context = (state: RoyaleState, playerId = "alpha") => ({
  config: { ...royaleManifest.config },
  players: state.players.map(({ id, slot }) => ({ id, slot })),
  playerId,
  tick: state.tick,
});

test("the manifest publishes the arena and default limits", () => {
  expect(royaleManifest).toMatchObject({
    id: "royale",
    release: "royale@0.2.0",
    botProtocolVersion: 1,
    minPlayers: 2,
    maxPlayers: 5,
    maxTicks: 800,
    arena: { seats: 5, keepMatches: 3, points: [10, 6, 3, 1, 0], tieBreakGameId: "paper" },
  });
  expect(royaleGame.manifest.resolvedLimits.cpuMs).toBe(20);
  expect(royaleGame.parseConfig(cloneJson(royaleManifest.config))).toStrictEqual(
    royaleManifest.config,
  );
  expect(() => royaleGame.parseConfig({ ...royaleManifest.config, shrinkInterval: 5 })).toThrow();
  expect(() => royaleGame.parseConfig({ ...royaleManifest.config, extra: 1 })).toThrow();
});

const initInput = () => ({
  seed: 2,
  config: { ...royaleManifest.config },
  players: IDS.slice(0, 3).map((id, slot) => ({ id, slot })),
});

test("initialization rejects bad seeds, configs, player counts, duplicate identities and slots", () => {
  for (const seed of [-1, 2 ** 32, 1.5, NaN, "2", null])
    expect(() => royaleRules.init({ ...initInput(), seed } as never)).toThrow();
  expect(() => royaleRules.init({ ...initInput(), config: { initialTerritorySize: 3 } })).toThrow();
  for (const players of [
    [{ id: "a", slot: 0 }],
    [...IDS, "zeta"].map((id, slot) => ({ id, slot })),
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
    expect(() => royaleRules.init({ ...initInput(), players })).toThrow();
  const reversed = { ...initInput(), players: initInput().players.toReversed() };
  expect(royaleRules.init(deepFreeze(reversed))).toStrictEqual(init(3));
});

test("actions have an exact schema", () => {
  for (const action of [idle(), ...(["up", "right", "down", "left"] as const).map(move)])
    expect(parseRoyaleAction(deepFreeze(action))).toStrictEqual({ ok: true, action });
  for (const raw of [
    null,
    "idle",
    {},
    { type: "idle", direction: "up" },
    { type: "move", direction: "UP" },
    { type: "move", direction: "left", extra: 1 },
    Object.create({ type: "idle" }),
  ])
    expect(parseRoyaleAction(raw).ok).toBe(false);
});

test("step requires exactly the living players' canonical actions", () => {
  const state = eliminate(init(3), 2);
  for (const raw of [
    {},
    { alpha: idle() },
    { alpha: idle(), beta: idle(), gamma: idle() },
    { alpha: idle(), beta: { type: "move", direction: "oops" } },
  ])
    expect(() => royaleRules.step(state, raw as never)).toThrow();
  const input = actions(state, { 0: move("up") });
  const reversed = Object.fromEntries(Object.entries(input).toReversed());
  expect(royaleRules.step(state, input)).toStrictEqual(royaleRules.step(state, reversed));
});

const base = () =>
  excursion(
    world([
      [5, 5],
      [10, 10],
      [20, 20],
    ]),
    1,
    [
      [11, 10],
      [12, 10],
    ],
    [[10, 10]],
  );

test("state validation rejects malformed or inconsistent worlds", () => {
  type Loose = RoyaleState & Record<string, unknown>;
  const corruptions: Array<(state: Loose) => void> = [
    (s) => void (s.width = 30),
    (s) => void (s.maxTicks = 500 as never),
    (s) => void (s.tick = 801),
    (s) => void (s.rngState = 0),
    (s) => void (s.extra = 1),
    (s) => void s.territory.pop(),
    (s) => void (s.territory[0] = 3),
    (s) => void (s.trails[0] = 1.5),
    (s) => void (s.players = s.players.toReversed()),
    (s) => void (s.players[1]!.id = "alpha"),
    (s) => void (s.players[1]!.spawn = { ...s.players[0]!.spawn }),
    (s) => void (s.players[0]!.position = null),
    (s) => void (s.players[0]!.position = { x: 10, y: 10 }),
    (s) => void (s.players[0]!.death = { tick: 0, causes: ["zone"] }),
    (s) => {
      eliminate(s, 2, 1);
      s.players[2]!.death = { tick: 1, causes: ["zone", "boundary"] };
    },
    (s) => {
      eliminate(s, 2, 1);
      s.territory[index(s, [0, 0])] = 2;
    },
    (s) => void (s.trails[index(s, [10, 10])] = 1),
    (s) => void (s.trails[index(s, [12, 10])] = -1),
    (s) => void (s.zoneSize = 30),
    (s) => {
      s.zoneSize = 29;
      s.tick = 10;
    },
  ];
  expect(parseRoyaleState(base())).toStrictEqual(base());
  for (const [number, corrupt] of corruptions.entries()) {
    const state = base() as Loose;
    corrupt(state);
    expect(() => parseRoyaleState(state), `corruption ${number}`).toThrow();
  }
  // With two alive the target is 26, so a zone of 29 is valid while nothing lies outside it.
  const shrunk = eliminate(
    world([
      [5, 5],
      [10, 10],
      [20, 20],
    ]),
    2,
  );
  shrunk.zoneSize = 29;
  shrunk.tick = 10;
  expect(parseRoyaleState(shrunk)).toStrictEqual(shrunk);
  shrunk.territory[index(shrunk, [0, 7])] = 0;
  expect(() => parseRoyaleState(shrunk), "land outside the zone").toThrow();
  const state = init(3);
  expect(() =>
    royaleGame.parseState(state, {
      ...context(state),
      players: context(state).players.slice(0, 2),
    }),
  ).toThrow();
  expect(() =>
    royaleGame.parseState(state, {
      ...context(state),
      players: context(state).players.map((p, i) => ({ ...p, id: IDS[(i + 1) % 3]! })),
    }),
  ).toThrow();
});

test("observations are public copies with the living, the eliminated and the zone", () => {
  const state = deepFreeze(eliminate(init(3), 2, 1));
  const observation = required(royaleRules.observe(state, "beta"));
  expect(observation).toMatchObject({
    tick: 1,
    maxTicks: 800,
    selfId: "beta",
    selfSlot: 1,
    zone: { size: 31, target: 26, min: { x: 0, y: 0 }, ticksToNextShrink: 9 },
    eliminated: [{ id: "gamma", slot: 2, tick: 1, causes: ["boundary"] }],
    events: [],
  });
  expect(observation.players.map((p) => [p.id, p.slot, p.area])).toStrictEqual([
    ["alpha", 0, 9],
    ["beta", 1, 9],
  ]);
  expect(observation).not.toHaveProperty("rngState");
  expect(observation.players[0]).not.toHaveProperty("death");
  observation.board.territory[0] = 1;
  expect(state.territory[0]).toBe(-1);
  expect(royaleRules.observe(state, "gamma")).toBe(null);
  expect(() => royaleRules.observe(state, "nobody")).toThrow(/Unknown/);
  expect(royaleRules.defaultAction(state, "alpha")).toStrictEqual(idle());
});

test("observation validation checks identity, seats, areas, zone and events", () => {
  const state = eliminate(init(3), 2, 1);
  const before = step(state, { 0: move("up") });
  const raw = required(royaleRules.observe(before.nextState, "alpha", { events: before.events }));
  const ctx = context(before.nextState);
  expect(royaleGame.parseObservation(raw, ctx)).toStrictEqual(raw);
  const corruptions: Array<(o: RoyaleObservation) => void> = [
    (o) => void (o.selfSlot = 1),
    (o) => void (o.tick = 3),
    (o) => void (o.players[0]!.area = 10),
    (o) => void (o.players[0]!.id = "gamma"),
    (o) => void (o.players[1]!.slot = 2),
    (o) => void (o.zone.target = 31),
    (o) => void (o.zone.ticksToNextShrink = null),
    (o) => void (o.zone.min = { x: 1, y: 1 }),
    (o) => void (o.eliminated[0]!.tick = 5),
    (o) => void o.eliminated.pop(),
    (o) => void (o.board.trails[0] = 0),
    (o) =>
      void (o.events = [
        { type: "move", playerId: "nobody", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
      ]),
    (o) => void (o.events = [{ type: "capture", playerId: "alpha", cells: [3, 2] }]),
    (o) => void (o.events = [{ type: "zone-shrink", size: 30 }]),
    (o) =>
      void (o.events = [
        { type: "death", playerId: "gamma", position: { x: 1, y: 1 }, causes: [] },
      ]),
  ];
  for (const [number, corrupt] of corruptions.entries()) {
    const copy = cloneJson(raw);
    corrupt(copy);
    expect(() => royaleGame.parseObservation(copy, ctx), `corruption ${number}`).toThrow();
  }
  expect(() => royaleGame.parseObservation(raw, { ...ctx, playerId: "beta" })).toThrow();
  expect(() => royaleGame.parseObservation({ ...raw, rngState: 1 }, ctx)).toThrow();
  const first = required(royaleRules.observe(init(3), "alpha"));
  expect(() => parseRoyaleObservation({ ...first, events: before.events })).toThrow();
});

test("engine snapshots share validated grids read-only", () => {
  const snapshot = snapshotJson(init(5));
  const observation = required(royaleRules.observe(snapshot, "delta"));
  expect(observation.board.territory).toBe(snapshot.territory);
  const ctx = context(init(5), "delta");
  const parsed = royaleGame.parseObservation(snapshotJson(observation), ctx);
  expect(parsed.board.trails).toBe(snapshot.trails);
  expect(royaleGame.parseState(snapshot, ctx).territory).toBe(snapshot.territory);
  expect(parseRoyaleState(snapshot).territory).not.toBe(snapshot.territory);
  const invalid = init(5);
  invalid.trails[0] = 7;
  expect(() => royaleRules.observe(snapshotJson(invalid), "alpha")).toThrow();
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
    expect(step(init(5, 0)).nextState.tick).toBe(1);
  } finally {
    Math.random = random;
    Date.now = now;
  }
});

test("generated games stay valid and replay identically from JSON records", () => {
  for (const players of [2, 3, 4, 5]) {
    for (let seed = 1; seed <= 4; seed++) {
      const initial = init(players, seed);
      const pick = randomActions(seed * 7 + players);
      const records: Record<string, unknown>[] = [];
      let state = initial;
      for (;;) {
        const input = pick(state);
        records.push(input);
        const output = royaleRules.step(state, input);
        expect(() => parseRoyaleState(output.nextState)).not.toThrow();
        state = output.nextState;
        if (output.result) break;
      }
      let replayed = JSON.parse(JSON.stringify(initial)) as RoyaleState;
      for (const input of JSON.parse(JSON.stringify(records)) as never[])
        replayed = royaleRules.step(replayed, input).nextState;
      expect(replayed).toStrictEqual(state);
      expect(state.rngState, "step does not draw random numbers").toBe(initial.rngState);
    }
  }
}, 30000);

test("shared immutable observation validation still checks identity and changed common fields", () => {
  const state = snapshotJson(init());
  const observations = state.players.map((player) =>
    snapshotJson(royaleRules.observe(state, player.id)!),
  );
  const first = observations[0]!;
  expect(observations[1]!.board).toBe(first.board);
  for (const observation of observations)
    expect(parseRoyaleObservation(observation).selfId).toBe(observation.selfId);
  expect(() =>
    parseRoyaleObservation(snapshotJson({ ...observations[1], selfId: first.selfId })),
  ).toThrow(/identity/);
  const zone = { ...first.zone, target: 999 };
  expect(() => parseRoyaleObservation(snapshotJson({ ...first, zone }))).toThrow();
  const players = first.players.map((player, i) => ({
    ...player,
    area: i === 0 ? 999 : player.area,
  }));
  expect(() => parseRoyaleObservation(snapshotJson({ ...first, players }))).toThrow();
});

test("mutable previous events cannot reuse an immutable world's cached observation", () => {
  const state = snapshotJson(init());
  const events: RoyaleEvent[] = [];
  royaleRules.observe(state, "alpha", { events });
  events.push({ type: "capture", playerId: "unknown", cells: [] });
  expect(() => royaleRules.observe(state, "beta", { events })).toThrow();
});
