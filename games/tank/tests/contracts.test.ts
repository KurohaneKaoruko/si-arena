import { expect, test } from "vitest";
import { cloneJson, snapshotJson } from "@si-arena/protocol";
import { tankManifest } from "@si-arena/game-tank";
import { tankGame } from "@si-arena/game-tank/game";
import type { TankEvent, TankObservation, TankState } from "@si-arena/game-tank/sdk";
import {
  parseTankAction,
  parseTankObservation,
  parseTankState,
  tankRules,
} from "@si-arena/game-tank/rules";
import {
  IDS,
  actions,
  bullet,
  deepFreeze,
  fire,
  idle,
  init,
  move,
  randomActions,
  required,
  step,
  world,
} from "./helpers";

const context = (state: TankState, playerId = "alpha") => ({
  config: { ...tankManifest.config },
  players: state.tanks.map(({ id, slot }) => ({ id, slot })),
  playerId,
  tick: state.tick,
});

test("the manifest publishes a fixed 1v1 duel without an arena and with default limits", () => {
  expect(tankManifest).toMatchObject({
    id: "tank",
    botProtocolVersion: 1,
    minPlayers: 2,
    maxPlayers: 2,
    maxTicks: 600,
  });
  expect(tankManifest).not.toHaveProperty("arena");
  expect(tankGame.manifest.resolvedLimits.cpuMs).toBe(20);
  expect(tankGame.parseConfig(cloneJson(tankManifest.config))).toStrictEqual(tankManifest.config);
  expect(() => tankGame.parseConfig({ ...tankManifest.config, width: 20 })).toThrow();
  expect(() => tankGame.parseConfig({ ...tankManifest.config, extra: 1 })).toThrow();
});

const initInput = () => ({
  seed: 2,
  config: { ...tankManifest.config },
  players: IDS.map((id, slot) => ({ id, slot })),
});

test("initialization rejects bad seeds, configs, player counts, duplicate identities and slots", () => {
  for (const seed of [-1, 2 ** 32, 1.5, NaN, "2", null])
    expect(() => tankRules.init({ ...initInput(), seed } as never)).toThrow();
  expect(() => tankRules.init({ ...initInput(), config: { width: 21 } })).toThrow();
  for (const players of [
    [{ id: "a", slot: 0 }],
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
      { id: "c", slot: 2 },
    ],
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
    expect(() => tankRules.init({ ...initInput(), players })).toThrow();
  const reversed = { ...initInput(), players: initInput().players.toReversed() };
  expect(tankRules.init(deepFreeze(reversed))).toStrictEqual(init());
});

test("actions have an exact schema", () => {
  for (const action of [idle(), fire(), ...(["up", "right", "down", "left"] as const).map(move)])
    expect(parseTankAction(deepFreeze(action))).toStrictEqual({ ok: true, action });
  for (const raw of [
    null,
    "fire",
    {},
    { type: "idle", direction: "up" },
    { type: "fire", direction: "up" },
    { type: "move" },
    { type: "move", direction: "UP" },
    { type: "move", direction: "left", extra: 1 },
    Object.create({ type: "fire" }),
  ])
    expect(parseTankAction(raw).ok).toBe(false);
});

test("step requires exactly both tanks' canonical actions and ignores their order", () => {
  const state = init();
  for (const raw of [
    {},
    { alpha: idle() },
    { alpha: idle(), beta: idle(), gamma: idle() },
    { alpha: idle(), beta: { type: "move", direction: "oops" } },
    { alpha: idle(), beta: { type: "fire", direction: "up" } },
  ])
    expect(() => tankRules.step(state, raw as never)).toThrow();
  const input = actions(state, { 0: move("up"), 1: fire() });
  const reversed = Object.fromEntries(Object.entries(input).toReversed());
  expect(tankRules.step(state, input)).toStrictEqual(tankRules.step(state, reversed));
});

const base = () =>
  bullet(
    world(
      [
        [[5, 5], "right"],
        [[15, 9], "left"],
      ],
      { 0: 1, 1: 2 },
    ),
    1,
    [12, 9],
    "left",
  );

test("state validation rejects malformed or inconsistent worlds", () => {
  type Loose = TankState & Record<string, unknown>;
  const corruptions: Array<(state: Loose) => void> = [
    (s) => void (s.width = 20),
    (s) => void (s.height = 14),
    (s) => void (s.maxTicks = 500 as never),
    (s) => void (s.tick = 601),
    (s) => void (s.rngState = 0),
    (s) => void (s.extra = 1),
    (s) => void s.cells.pop(),
    (s) => void (s.cells[2] = 3),
    (s) => void (s.cells[3] = 1.5),
    (s) => void (s.cells[7 * 21 + 2] = 1),
    (s) => void (s.cells[5 * 21 + 5] = 1),
    (s) => void (s.tanks = s.tanks.toReversed()),
    (s) => void (s.tanks[1]!.id = "alpha"),
    (s) => void (s.tanks[1]!.position = { x: 5, y: 5 }),
    (s) => void (s.tanks[0]!.position = { x: 21, y: 5 }),
    (s) => void (s.tanks[0]!.position = null),
    (s) => void (s.tanks[0]!.hp = 0),
    (s) => void (s.tanks[0]!.hp = 4),
    (s) => void (s.tanks[0]!.facing = "north" as never),
    (s) => void (s.tanks[0]!.death = { tick: 0 }),
    (s) => {
      s.tick = 5;
      s.tanks[0]!.death = { tick: 4 };
      s.tanks[0]!.position = null;
      s.tanks[0]!.hp = 0;
    },
    (s) => {
      s.tick = 5;
      s.tanks[0]!.death = { tick: 5 };
      s.tanks[0]!.hp = 0;
    },
    (s) => void (s.bullets[0]!.owner = 2),
    (s) => void (s.bullets[0]!.direction = "left-ish" as never),
    (s) => void (s.bullets[0]!.position = { x: 0, y: 0 }),
    (s) => void s.bullets.push({ position: { x: 10, y: 9 }, direction: "left", owner: 1 }),
    (s) =>
      void s.bullets.push(
        { position: { x: 10, y: 9 }, direction: "left", owner: 0 },
        { position: { x: 9, y: 9 }, direction: "left", owner: 0 },
      ),
  ];
  expect(parseTankState(base())).toStrictEqual(base());
  for (const [number, corrupt] of corruptions.entries()) {
    const state = base() as Loose;
    corrupt(state);
    expect(() => parseTankState(state), `corruption ${number}`).toThrow();
  }
  const finished = base();
  finished.tick = 5;
  finished.tanks[0]!.death = { tick: 5 };
  finished.tanks[0]!.position = null;
  finished.tanks[0]!.hp = 0;
  expect(parseTankState(finished)).toStrictEqual(finished);
  finished.bullets.push({ position: { x: 3, y: 3 }, direction: "up", owner: 0 });
  expect(() => parseTankState(finished), "a destroyed tank has no bullet").toThrow();
  const state = init();
  expect(() =>
    tankGame.parseState(state, { ...context(state), players: context(state).players.slice(0, 1) }),
  ).toThrow();
  expect(() =>
    tankGame.parseState(state, {
      ...context(state),
      players: context(state).players.map((p, i) => ({ ...p, id: IDS[(i + 1) % 2]! })),
    }),
  ).toThrow();
});

test("observations are public copies with both tanks, the bullets and the last events", () => {
  const first = step(base(), { 0: fire(), 1: move("up") });
  const state = deepFreeze(first.nextState);
  const observation = required(tankRules.observe(state, "beta", { events: first.events }));
  expect(observation).toMatchObject({
    tick: 1,
    maxTicks: 600,
    selfId: "beta",
    selfSlot: 1,
    board: { width: 21, height: 15 },
    eliminated: [],
  });
  expect(observation.tanks).toStrictEqual([
    {
      id: "alpha",
      slot: 0,
      position: { x: 5, y: 5 },
      facing: "right",
      hp: 3,
      bulletInFlight: true,
    },
    { id: "beta", slot: 1, position: { x: 15, y: 8 }, facing: "up", hp: 3, bulletInFlight: true },
  ]);
  expect(observation.bullets).toStrictEqual([
    { position: { x: 10, y: 9 }, direction: "left", ownerSlot: 1 },
    { position: { x: 7, y: 5 }, direction: "right", ownerSlot: 0 },
  ]);
  expect(observation.events).toStrictEqual(first.events);
  expect(observation).not.toHaveProperty("rngState");
  expect(observation.tanks[0]).not.toHaveProperty("death");
  observation.board.cells[5] = 1;
  expect(state.cells[5]).toBe(0);
  expect(tankRules.defaultAction(state, "alpha")).toStrictEqual(idle());
});

test("observation validation checks identity, seats, bullets, terrain and events", () => {
  const before = step(base(), { 0: fire(), 1: move("up") });
  const raw = required(tankRules.observe(before.nextState, "alpha", { events: before.events }));
  const ctx = context(before.nextState);
  expect(tankGame.parseObservation(raw, ctx)).toStrictEqual(raw);
  const corruptions: Array<(o: TankObservation) => void> = [
    (o) => void (o.selfSlot = 1),
    (o) => void (o.tick = 3),
    (o) => void (o.tanks[0]!.hp = 0),
    (o) => void (o.tanks[0]!.id = "beta"),
    (o) => void (o.tanks[1]!.slot = 2),
    (o) => void (o.tanks[1]!.bulletInFlight = false),
    (o) => void (o.tanks[1]!.position = { x: 5, y: 5 }),
    (o) => void (o.board.cells[5 * 21 + 5] = 2),
    (o) => void (o.board.cells[0] = 3),
    (o) => void (o.bullets[0]!.ownerSlot = 0),
    (o) => void o.bullets.push({ position: { x: 1, y: 1 }, direction: "up", ownerSlot: 0 }),
    (o) => void (o.eliminated = [{ id: "beta", slot: 1, tick: 1 }]),
    (o) =>
      void (o.events = [
        {
          type: "move",
          playerId: "nobody",
          from: { x: 0, y: 0 },
          to: { x: 1, y: 0 },
          facing: "up",
        },
      ]),
    (o) => void (o.events = [{ type: "brick-destroyed", attackerId: "alpha", cells: [3, 2] }]),
    (o) => void (o.events = [{ type: "brick-destroyed", attackerId: "alpha", cells: [] }]),
    (o) =>
      void (o.events = [
        { type: "hit", playerId: "alpha", attackerId: "alpha", position: { x: 1, y: 1 }, hp: 2 },
      ]),
    (o) =>
      void (o.events = [
        { type: "hit", playerId: "alpha", attackerId: "beta", position: { x: 1, y: 1 }, hp: 3 },
      ]),
    (o) => void (o.events = [{ type: "death", playerId: "beta", position: { x: 1, y: 15 } }]),
    (o) => void (o.events = [{ type: "boom" } as never]),
  ];
  for (const [number, corrupt] of corruptions.entries()) {
    const copy = cloneJson(raw);
    corrupt(copy);
    expect(() => tankGame.parseObservation(copy, ctx), `corruption ${number}`).toThrow();
  }
  expect(() => tankGame.parseObservation(raw, { ...ctx, playerId: "beta" })).toThrow();
  expect(() => tankGame.parseObservation({ ...raw, rngState: 1 }, ctx)).toThrow();
  const first = required(tankRules.observe(init(), "alpha"));
  expect(() => parseTankObservation({ ...first, events: before.events })).toThrow();
});

test("engine snapshots share validated terrain read-only", () => {
  const snapshot = snapshotJson(init());
  const observation = required(tankRules.observe(snapshot, "beta"));
  expect(observation.board.cells).toBe(snapshot.cells);
  const ctx = context(init(), "beta");
  const parsed = tankGame.parseObservation(snapshotJson(observation), ctx);
  expect(parsed.board.cells).toBe(snapshot.cells);
  expect(tankGame.parseState(snapshot, ctx).cells).toBe(snapshot.cells);
  expect(parseTankState(snapshot).cells).not.toBe(snapshot.cells);
  const invalid = init();
  invalid.cells[0] = 7;
  expect(() => tankRules.observe(snapshotJson(invalid), "alpha")).toThrow();
  // A tick that breaks nothing keeps sharing the immutable terrain.
  expect(tankRules.step(snapshot, actions(snapshot as TankState)).nextState.cells).toBe(
    snapshot.cells,
  );
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
    expect(step(init(0), { 0: fire(), 1: move("up") }).nextState.tick).toBe(1);
  } finally {
    Math.random = random;
    Date.now = now;
  }
});

test("generated games stay valid and replay identically from JSON records", () => {
  for (let seed = 1; seed <= 6; seed++) {
    const initial = init(seed);
    const pick = randomActions(seed * 7);
    const records: Record<string, unknown>[] = [];
    let state = initial;
    for (;;) {
      const input = pick(state);
      records.push(input);
      const output = tankRules.step(state, input);
      expect(() => parseTankState(output.nextState)).not.toThrow();
      state = output.nextState;
      if (output.result) break;
    }
    let replayed = JSON.parse(JSON.stringify(initial)) as TankState;
    for (const input of JSON.parse(JSON.stringify(records)) as never[])
      replayed = tankRules.step(replayed, input).nextState;
    expect(replayed).toStrictEqual(state);
    expect(state.rngState, "step does not draw random numbers").toBe(initial.rngState);
  }
}, 30000);

test("shared immutable observation validation still checks identity and changed common fields", () => {
  const state = snapshotJson(init());
  const observations = state.tanks.map((tank) => snapshotJson(tankRules.observe(state, tank.id)!));
  const first = observations[0]!;
  expect(observations[1]!.board).toBe(first.board);
  for (const observation of observations)
    expect(parseTankObservation(observation).selfId).toBe(observation.selfId);
  expect(() =>
    parseTankObservation(snapshotJson({ ...observations[1], selfId: first.selfId })),
  ).toThrow(/identity/);
  const tanks = first.tanks.map((tank, i) => ({ ...tank, hp: i === 0 ? 9 : tank.hp }));
  expect(() => parseTankObservation(snapshotJson({ ...first, tanks }))).toThrow();
  const bullets = [{ position: { x: 1, y: 1 }, direction: "up" as const, ownerSlot: 0 }];
  expect(() => parseTankObservation(snapshotJson({ ...first, bullets }))).toThrow();
});

test("mutable previous events cannot reuse an immutable world's cached observation", () => {
  const state = snapshotJson(init());
  const events: TankEvent[] = [];
  tankRules.observe(state, "alpha", { events });
  events.push({ type: "death", playerId: "unknown", position: { x: 0, y: 0 } });
  expect(() => tankRules.observe(state, "beta", { events })).toThrow();
});
