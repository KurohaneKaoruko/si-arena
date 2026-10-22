import { expect, test } from "vitest";
import { cloneJson, snapshotJson } from "@si-arena/protocol";
import { snakeManifest } from "@si-arena/game-snake";
import { snakeGame } from "@si-arena/game-snake/game";
import type { SnakeEvent, SnakeObservation, SnakeState } from "@si-arena/game-snake/sdk";
import {
  parseSnakeAction,
  parseSnakeObservation,
  parseSnakeState,
  snakeRules,
} from "@si-arena/game-snake/rules";
import {
  IDS,
  actions,
  deepFreeze,
  eliminate,
  init,
  move,
  randomActions,
  required,
  step,
  world,
} from "./helpers";

const context = (state: SnakeState, playerId = "alpha") => ({
  config: { ...snakeManifest.config },
  players: state.snakes.map(({ id, slot }) => ({ id, slot })),
  playerId,
  tick: state.tick,
});

test("the manifest publishes the arena and default limits", () => {
  expect(snakeManifest).toMatchObject({
    id: "snake",
    release: "snake@0.1.0",
    botProtocolVersion: 1,
    minPlayers: 2,
    maxPlayers: 4,
    maxTicks: 500,
    arena: { seats: 4, keepMatches: 3, tieBreakGameId: "paper" },
  });
  expect(snakeGame.manifest.resolvedLimits.cpuMs).toBe(20);
  expect(snakeGame.parseConfig(cloneJson(snakeManifest.config))).toStrictEqual(
    snakeManifest.config,
  );
  expect(() => snakeGame.parseConfig({ ...snakeManifest.config, maxHealth: 50 })).toThrow();
  expect(() => snakeGame.parseConfig({ ...snakeManifest.config, extra: 1 })).toThrow();
});

const initInput = () => ({
  seed: 2,
  config: { ...snakeManifest.config },
  players: IDS.slice(0, 3).map((id, slot) => ({ id, slot })),
});

test("initialization rejects bad seeds, configs, player counts, duplicate identities and slots", () => {
  for (const seed of [-1, 2 ** 32, 1.5, NaN, "2", null])
    expect(() => snakeRules.init({ ...initInput(), seed } as never)).toThrow();
  expect(() => snakeRules.init({ ...initInput(), config: { initialLength: 3 } })).toThrow();
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
    expect(() => snakeRules.init({ ...initInput(), players })).toThrow();
  const reversed = { ...initInput(), players: initInput().players.toReversed() };
  expect(snakeRules.init(deepFreeze(reversed))).toStrictEqual(init(3));
});

test("actions have an exact schema", () => {
  for (const action of (["up", "right", "down", "left"] as const).map(move))
    expect(parseSnakeAction(deepFreeze(action))).toStrictEqual({ ok: true, action });
  for (const raw of [
    null,
    "move",
    {},
    { type: "idle" },
    { type: "move" },
    { type: "move", direction: "UP" },
    { type: "move", direction: "left", extra: 1 },
    Object.create({ type: "move", direction: "up" }),
  ])
    expect(parseSnakeAction(raw).ok).toBe(false);
});

test("step requires exactly the living snakes' canonical actions", () => {
  const state = eliminate(init(3), 2);
  for (const raw of [
    {},
    { alpha: move("up") },
    { alpha: move("up"), beta: move("up"), gamma: move("up") },
    { alpha: move("up"), beta: { type: "move", direction: "oops" } },
  ])
    expect(() => snakeRules.step(state, raw as never)).toThrow();
  const input = actions(state, { 0: move("up") });
  const reversed = Object.fromEntries(Object.entries(input).toReversed());
  expect(snakeRules.step(state, input)).toStrictEqual(snakeRules.step(state, reversed));
});

const base = () =>
  world(
    [
      [
        [5, 5],
        [4, 5],
        [3, 5],
      ],
      [
        [10, 10],
        [10, 9],
        [10, 8],
        [10, 8],
      ],
      [
        [14, 2],
        [14, 3],
        [14, 4],
      ],
    ],
    [
      [1, 1],
      [8, 8],
    ],
  );

test("state validation rejects malformed or inconsistent worlds", () => {
  type Loose = SnakeState & Record<string, unknown>;
  const corruptions: Array<(state: Loose) => void> = [
    (s) => void (s.width = 19),
    (s) => void (s.maxTicks = 800 as never),
    (s) => void (s.tick = 501),
    (s) => void (s.rngState = 0),
    (s) => void (s.extra = 1),
    (s) => void (s.snakes = s.snakes.toReversed()),
    (s) => void (s.snakes[1]!.id = "alpha"),
    (s) => void (s.snakes[0]!.body.pop(), s.snakes[0]!.body.pop()),
    (s) => void (s.snakes[0]!.body[2] = { x: 2, y: 5 }),
    (s) => void (s.snakes[0]!.body[1] = { x: 5, y: 5 }),
    (s) => void s.snakes[0]!.body.splice(2, 0, { x: 4, y: 5 }),
    (s) =>
      void s.snakes[0]!.body.push({ x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 5, y: 5 }),
    (s) => void (s.snakes[0]!.heading = "down"),
    (s) => void (s.snakes[0]!.heading = "north" as never),
    (s) => void (s.snakes[0]!.health = 0),
    (s) => void (s.snakes[0]!.health = 101),
    (s) => void (s.snakes[0]!.body[0] = { x: 17, y: 5 }),
    (s) => void (s.snakes[0]!.body[0] = { x: 5, y: -1 }),
    (s) =>
      void (s.snakes[2]!.body = [
        { x: 10, y: 9 },
        { x: 10, y: 10 },
        { x: 10, y: 11 },
      ]),
    (s) => void (s.snakes[0]!.death = { tick: 0, causes: ["boundary"] }),
    (s) => void (s.snakes[0]!.death = { tick: 1, causes: ["boundary"] }),
    (s) => {
      eliminate(s, 2, 1);
      s.snakes[2]!.health = 100;
    },
    (s) => {
      eliminate(s, 2, 1);
      s.snakes[2]!.death = { tick: 1, causes: ["head-collision", "boundary"] };
    },
    (s) => {
      eliminate(s, 2, 1);
      s.snakes[2]!.death = { tick: 1, causes: [] };
    },
    (s) => {
      eliminate(s, 2, 1);
      s.snakes[2]!.death = { tick: 2, causes: ["starvation"] };
    },
    (s) => void (s.food[0] = { x: 4, y: 5 }),
    (s) => void (s.food = s.food.toReversed()),
    (s) => void (s.food[1] = { x: 1, y: 1 }),
    (s) => void (s.food[1] = { x: 1, y: 17 }),
  ];
  expect(parseSnakeState(base())).toStrictEqual(base());
  for (const [number, corrupt] of corruptions.entries()) {
    const state = base() as Loose;
    corrupt(state);
    expect(() => parseSnakeState(state), `corruption ${number}`).toThrow();
  }
  const dead = eliminate(base(), 2, 1);
  expect(parseSnakeState(dead)).toStrictEqual(dead);
  const state = init(3);
  expect(() =>
    snakeGame.parseState(state, {
      ...context(state),
      players: context(state).players.slice(0, 2),
    }),
  ).toThrow();
  expect(() =>
    snakeGame.parseState(state, {
      ...context(state),
      players: context(state).players.map((p, i) => ({ ...p, id: IDS[(i + 1) % 3]! })),
    }),
  ).toThrow();
});

test("observations are public copies with the living, the eliminated and the food", () => {
  const state = deepFreeze(eliminate(init(3), 2, 1));
  const observation = required(snakeRules.observe(state, "beta"));
  expect(observation).toMatchObject({
    tick: 1,
    maxTicks: 500,
    selfId: "beta",
    selfSlot: 1,
    board: { width: 17, height: 17 },
    eliminated: [{ id: "gamma", slot: 2, tick: 1, causes: ["boundary"] }],
    events: [],
  });
  expect(observation.snakes.map((s) => [s.id, s.slot, s.length])).toStrictEqual([
    ["alpha", 0, 3],
    ["beta", 1, 3],
  ]);
  expect(observation).not.toHaveProperty("rngState");
  expect(observation.snakes[0]).not.toHaveProperty("death");
  observation.food[0]!.x = 99;
  observation.snakes[0]!.body[0]!.x = 99;
  expect(state.food[0]!.x).not.toBe(99);
  expect(state.snakes[0]!.body[0]!.x).not.toBe(99);
  expect(snakeRules.observe(state, "gamma")).toBe(null);
  expect(() => snakeRules.observe(state, "nobody")).toThrow(/Unknown/);
});

test("observation validation checks identity, seats, bodies, food and events", () => {
  const state = eliminate(init(3), 2, 1);
  const before = step(state, { 0: move("down") });
  const raw = required(snakeRules.observe(before.nextState, "alpha", { events: before.events }));
  const ctx = context(before.nextState);
  expect(snakeGame.parseObservation(raw, ctx)).toStrictEqual(raw);
  const corruptions: Array<(o: SnakeObservation) => void> = [
    (o) => void (o.selfSlot = 1),
    (o) => void (o.tick = 3),
    (o) => void (o.snakes[0]!.head = { x: 0, y: 0 }),
    (o) => void (o.snakes[0]!.length = 4),
    (o) => void (o.snakes[0]!.health = 0),
    (o) => void (o.snakes[0]!.id = "gamma"),
    (o) => void (o.snakes[1]!.slot = 2),
    (o) => void (o.snakes[1]!.body[1] = { x: 0, y: 0 }),
    (o) => void (o.board.width = 19),
    (o) => void (o.eliminated[0]!.tick = 5),
    (o) => void o.eliminated.pop(),
    (o) => void (o.food[0] = { ...o.snakes[0]!.body[1]! }),
    (o) =>
      void (o.events = [
        { type: "move", playerId: "nobody", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
      ]),
    (o) =>
      void (o.events = [
        { type: "move", playerId: "alpha", from: { x: 0, y: 0 }, to: { x: -2, y: 0 } },
      ]),
    (o) => void (o.events = [{ type: "eat", playerId: "alpha", position: { x: -1, y: 0 } }]),
    (o) =>
      void (o.events = [
        { type: "death", playerId: "gamma", position: { x: 1, y: 1 }, causes: [] },
      ]),
    (o) => void (o.events = [{ type: "food-spawn", position: { x: 17, y: 1 } }]),
    (o) => void (o.events = Array.from({ length: 12 }, () => raw.events[0]!)),
  ];
  for (const [number, corrupt] of corruptions.entries()) {
    const copy = cloneJson(raw);
    corrupt(copy);
    expect(() => snakeGame.parseObservation(copy, ctx), `corruption ${number}`).toThrow();
  }
  expect(() => snakeGame.parseObservation(raw, { ...ctx, playerId: "beta" })).toThrow();
  expect(() => snakeGame.parseObservation({ ...raw, rngState: 1 }, ctx)).toThrow();
  const first = required(snakeRules.observe(init(3), "alpha"));
  expect(() => parseSnakeObservation({ ...first, events: before.events })).toThrow();
  // A boundary death reports the cell beyond the edge in both the move and the death event.
  const edge = world([
    [
      [0, 5],
      [1, 5],
      [2, 5],
    ],
    [
      [10, 10],
      [10, 9],
      [10, 8],
    ],
    [
      [14, 2],
      [14, 3],
      [14, 4],
    ],
  ]);
  const fallen = step(edge, { 0: move("left") });
  const after = required(snakeRules.observe(fallen.nextState, "beta", { events: fallen.events }));
  expect(after.events.filter((e) => e.type === "death")).toStrictEqual([
    { type: "death", playerId: "alpha", position: { x: -1, y: 5 }, causes: ["boundary"] },
  ]);
  expect(
    snakeGame.parseObservation(cloneJson(after), context(fallen.nextState, "beta")),
  ).toStrictEqual(after);
});

test("engine snapshots share validated lists read-only", () => {
  const snapshot = snapshotJson(init(4));
  const observation = required(snakeRules.observe(snapshot, "delta"));
  expect(observation.food).toBe(snapshot.food);
  expect(observation.snakes[0]!.body).toBe(snapshot.snakes[0]!.body);
  const ctx = context(init(4), "delta");
  const parsed = snakeGame.parseObservation(snapshotJson(observation), ctx);
  expect(parsed.food).toBe(snapshot.food);
  expect(snakeGame.parseState(snapshot, ctx).food).toBe(snapshot.food);
  expect(parseSnakeState(snapshot).food).not.toBe(snapshot.food);
  expect(parseSnakeState(snapshot).snakes[0]!.body).not.toBe(snapshot.snakes[0]!.body);
  const invalid = init(4);
  invalid.food[0] = { ...invalid.snakes[0]!.body[0]! };
  expect(() => snakeRules.observe(snapshotJson(invalid), "alpha")).toThrow();
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
    // A food spawn draws from rngState only.
    const state = init(4, 0);
    state.food = state.food.slice(0, 2);
    const output = step(state);
    expect(output.nextState.tick).toBe(1);
    expect(output.nextState.rngState).not.toBe(state.rngState);
  } finally {
    Math.random = random;
    Date.now = now;
  }
});

test("generated games end in time, stay valid and replay identically from JSON records", () => {
  let drew = 0;
  for (const players of [2, 3, 4]) {
    for (let seed = 1; seed <= 4; seed++) {
      const initial = init(players, seed);
      const pick = randomActions(seed * 7 + players);
      const records: Record<string, unknown>[] = [];
      let state = initial;
      for (;;) {
        const input = pick(state);
        records.push(input);
        const output = snakeRules.step(state, input);
        expect(() => parseSnakeState(output.nextState)).not.toThrow();
        state = output.nextState;
        if (output.result) break;
      }
      expect(state.tick).toBeLessThanOrEqual(500);
      let replayed = JSON.parse(JSON.stringify(initial)) as SnakeState;
      for (const input of JSON.parse(JSON.stringify(records)) as never[])
        replayed = snakeRules.step(replayed, input).nextState;
      expect(replayed).toStrictEqual(state);
      expect(replayed.rngState).toBe(state.rngState);
      expect(replayed.food).toStrictEqual(state.food);
      if (state.rngState !== initial.rngState) drew++;
    }
  }
  expect(drew, "some generated games spawn food").toBeGreaterThan(6);
}, 30000);

test("shared immutable observation validation still checks identity and changed common fields", () => {
  const state = snapshotJson(init());
  const observations = state.snakes.map((snake) =>
    snapshotJson(snakeRules.observe(state, snake.id)!),
  );
  const first = observations[0]!;
  expect(observations[1]!.snakes).toBe(first.snakes);
  for (const observation of observations)
    expect(parseSnakeObservation(observation).selfId).toBe(observation.selfId);
  expect(() =>
    parseSnakeObservation(snapshotJson({ ...observations[1], selfId: first.selfId })),
  ).toThrow(/identity/);
  const food = [...first.food, { ...first.snakes[0]!.body[0]! }];
  expect(() => parseSnakeObservation(snapshotJson({ ...first, food }))).toThrow();
  const snakes = first.snakes.map((snake, i) => ({
    ...snake,
    length: i === 0 ? 99 : snake.length,
  }));
  expect(() => parseSnakeObservation(snapshotJson({ ...first, snakes }))).toThrow();
});

test("mutable previous events cannot reuse an immutable world's cached observation", () => {
  const state = snapshotJson(init());
  const events: SnakeEvent[] = [];
  snakeRules.observe(state, "alpha", { events });
  events.push({ type: "eat", playerId: "unknown", position: { x: 0, y: 0 } });
  expect(() => snakeRules.observe(state, "beta", { events })).toThrow();
});
