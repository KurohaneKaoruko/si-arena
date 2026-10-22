import type { PaperState } from "@si-arena/game-paper/sdk";
import { parsePaperAction } from "@si-arena/game-paper/rules";
import { initUnknown, stepUnknown } from "./helpers";
import { test, expect } from "vitest";
import { paperManifest } from "@si-arena/game-paper";
import { paperRules, parsePaperState } from "@si-arena/game-paper/rules";
import { actions, deepFreeze, idle, init, move, outside, stepFrozen, world } from "./helpers";
import { required, eventOf } from "./helpers";
import { paperGame } from "@si-arena/game-paper/game";
import { cloneJson, snapshotJson } from "@si-arena/protocol";

const validInit = () => ({
  seed: 2,
  config: { ...paperManifest.config },
  players: [
    { id: "alpha", slot: 0 },
    { id: "beta", slot: 1 },
  ],
});

test("public observations validate independent schemas, identity, grids and previous event data", () => {
  const initial = init();
  const output = stepFrozen(initial, actions(move("right")));
  const raw = required(paperRules.observe(output.nextState, "alpha", { events: output.events }));
  const context = {
    config: { ...paperManifest.config },
    players: initial.players,
    playerId: "alpha",
    tick: 1,
  };
  expect(paperGame.parseObservation(raw, context)).toEqual(raw);
  expect(raw.events).toEqual(output.events);
  raw.events.length = 0;
  expect(output.events.length).toBeGreaterThan(0);
  const corruptions: Array<(copy: typeof raw) => void> = [
    (c) => {
      c.selfSlot = 1;
    },
    (c) => {
      c.players[0].id = "other";
    },
    (c) => {
      c.tick = 2;
    },
    (c) => {
      c.board.territory[0] = 99;
    },
    (c) => {
      c.players[0].position.x = -1;
    },
    (c) => {
      c.events = [{ type: "move", playerId: "unknown", from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }];
    },
    (c) => {
      c.events = [{ type: "capture", playerId: "alpha", cells: [0, 0] }];
    },
  ];
  for (const corrupt of corruptions) {
    const copy = cloneJson(raw);
    corrupt(copy);
    expect(() => paperGame.parseObservation(copy, context)).toThrow();
  }
  expect(() => paperGame.parseObservation({ ...raw, rngState: 1 }, context)).toThrow();
  expect(() =>
    paperGame.parseObservation(
      { ...raw, players: raw.players.map((p) => ({ ...p, alive: true })) },
      context,
    ),
  ).toThrow();
  expect(() =>
    paperGame.parseObservation({ ...raw, tick: 0, events: output.events }, { ...context, tick: 0 }),
  ).toThrow();
});

test("initial state has fixed seats, symmetric homes and seeded xorshift32 placement", () => {
  const state = init(2);
  expect(state.players.map((player) => player.position)).toStrictEqual([
    { x: 5, y: 14 },
    { x: 24, y: 14 },
  ]);
  expect(state.spawns, "the spawn is the reset target of a slot").toStrictEqual([
    { x: 5, y: 14 },
    { x: 24, y: 14 },
  ]);
  expect(state.rngState).toBe(540738);
  expect(state.tick).toBe(0);
  expect(state.territory.length).toBe(900);
  expect(state.trails.length).toBe(900);
  expect(state.trails.every((owner) => owner === -1)).toBeTruthy();
  for (const player of state.players) {
    const cells = state.territory.flatMap((owner, index) => (owner === player.slot ? [index] : []));
    expect(cells.length).toBe(9);
    expect(cells).toStrictEqual(
      [13, 14, 15].flatMap((y) =>
        [
          required(player.position).x - 1,
          required(player.position).x,
          required(player.position).x + 1,
        ].map((x) => y * 30 + x),
      ),
    );
  }
  const swapped = init(1);
  expect(swapped.rngState).toBe(270369);
  expect(swapped.players.map((player) => player.id)).toStrictEqual(["alpha", "beta"]);
  expect(swapped.players.map((player) => player.position)).toStrictEqual([
    { x: 24, y: 14 },
    { x: 5, y: 14 },
  ]);
  expect(swapped.spawns).toStrictEqual([
    { x: 24, y: 14 },
    { x: 5, y: 14 },
  ]);
  expect(parsePaperState(state)).toStrictEqual(state);
});

test("zero seed uses the documented nonzero state and input order cannot change seats", () => {
  expect(init(0)).toStrictEqual(init(0x9e3779b9));
  const input = {
    seed: 2,
    config: { ...paperManifest.config },
    players: [
      { id: "beta", slot: 1 },
      { id: "alpha", slot: 0 },
    ],
  };
  expect(paperRules.init(deepFreeze(input))).toStrictEqual(init(2));
  const first = init();
  first.territory[0] = 0;
  required(first.players[0].position).x = 0;
  expect(init()).toStrictEqual(init(2));
  expect(paperManifest.config).toStrictEqual({ width: 30, height: 30, initialTerritorySize: 3 });
});

test("initialization rejects unsupported seeds, maps, duplicate identities and slots", () => {
  for (const seed of [-1, 2 ** 32, 1.5, NaN, Infinity, "2", null])
    expect(() => initUnknown({ ...validInit(), seed })).toThrow();
  for (const config of [
    {},
    { ...paperManifest.config, width: 29 },
    { ...paperManifest.config, height: 31 },
    { ...paperManifest.config, initialTerritorySize: 5 },
    { ...paperManifest.config, extra: 1 },
  ]) {
    expect(() => initUnknown({ ...validInit(), config })).toThrow();
  }
  for (const players of [
    [],
    [{ id: "a", slot: 0 }],
    [
      { id: "a", slot: 0 },
      { id: "a", slot: 1 },
    ],
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 0 },
    ],
    [
      { id: "", slot: 0 },
      { id: "b", slot: 1 },
    ],
  ]) {
    expect(() => initUnknown({ ...validInit(), players })).toThrow();
  }
});

test("actions have an exact schema and are normalized to fresh plain objects", () => {
  for (const action of [idle(), ...(["up", "right", "down", "left"] as const).map(move)]) {
    const parsed = paperRules.parseAction(deepFreeze(action));
    expect(parsed).toStrictEqual({ ok: true, action });
    expect(parsed.ok ? parsed.action : undefined).not.toBe(action);
  }
  for (const raw of [
    null,
    undefined,
    [],
    1,
    "idle",
    {},
    { type: "idle", direction: "up" },
    { type: "move" },
    { type: "move", direction: "UP" },
    { type: "move", direction: "left", extra: 1 },
    new Date(),
    Object.create({ type: "idle" }),
    { type: "idle", [Symbol("extra")]: 1 },
  ]) {
    expect(parsePaperAction(raw).ok).toBe(false);
  }
  let getterCalls = 0;
  expect(
    paperRules.parseAction({
      get type() {
        getterCalls++;
        return "idle";
      },
    }).ok,
  ).toBe(false);
  expect(getterCalls).toBe(0);
  expect(paperRules.parseAction(Object.assign(Object.create(null), idle()))).toStrictEqual({
    ok: true,
    action: idle(),
  });
});

test("state schema rejects malformed worlds and inconsistent living/dead ownership", () => {
  type MalformedState = Omit<PaperState, "width" | "maxTicks"> & {
    width: number;
    maxTicks: number;
    [key: string]: unknown;
  };
  const modifications: Array<(state: MalformedState) => void> = [
    (s) => {
      s.width = 29;
    },
    (s) => {
      s.maxTicks = 501;
    },
    (s) => {
      s.tick = -1;
    },
    (s) => {
      s.tick = 501;
    },
    (s) => {
      s.rngState = 0;
    },
    (s) => {
      s.rngState = 2 ** 32;
    },
    (s) => {
      s.territory.pop();
    },
    (s) => {
      delete s.trails[5];
    },
    (s) => {
      s.territory[0] = 2;
    },
    (s) => {
      s.trails[0] = NaN;
    },
    (s) => {
      s.players.reverse();
    },
    (s) => {
      s.players[0].id = s.players[1].id;
    },
    (s) => {
      required(s.players[0].position).x = 30;
    },
    (s) => {
      s.players[0].position = null;
    },
    (s) => {
      s.players[0].alive = false;
    },
    (s) => {
      s.players[0].position = { ...required(s.players[1].position) };
    },
    (s) => {
      s.trails[0] = 0;
    },
    (s) => {
      s.spawns = [] as unknown as PaperState["spawns"];
    },
    (s) => {
      s.spawns[0] = { x: 30, y: 14 };
    },
    (s) => {
      s.spawns[1] = { ...s.spawns[0] };
    },
    (s) => {
      s.spawns[0] = { x: 5 } as unknown as PaperState["spawns"][0];
    },
    (s) => {
      s.extra = 1;
    },
  ];
  for (const modify of modifications) {
    const state: MalformedState = { ...init() };
    modify(state);
    expect(() => parsePaperState(state)).toThrow();
  }
  const copied = parsePaperState(deepFreeze(init()));
  copied.territory[0] = 0;
  expect(init().territory[0]).toBe(-1);
});

test("observations are detached JSON copies with fixed self identity and no private data", () => {
  const state = deepFreeze(init());
  const first = required(paperRules.observe(state, "alpha"));
  const second = required(paperRules.observe(state, "beta"));
  expect(first.selfSlot).toBe(0);
  expect(second.selfSlot).toBe(1);
  expect(first.selfId).toBe("alpha");
  expect(JSON.parse(JSON.stringify(first))).toStrictEqual(first);
  required(first.players[1].position).x = 0;
  first.board.territory[0] = 1;
  first.board.trails[0] = 0;
  expect(second.players[1].position).toStrictEqual(state.players[1].position);
  expect(first).not.toHaveProperty("rngState");
  expect(first.players[0]).not.toHaveProperty("alive");
  expect(state.territory[0]).toBe(-1);
  expect(second.board.trails[0]).toBe(-1);
  expect(() => paperRules.observe(state, "nobody")).toThrow(/Unknown/);
  expect(() => paperRules.defaultAction(state, "nobody")).toThrow(/Unknown/);
  expect(paperRules.defaultAction(state, "alpha")).toStrictEqual(idle());
});

test("cached frozen grids stay detached and never admit invalid immutable or changed mutable grids", () => {
  const frozen = deepFreeze(init());
  const first = parsePaperState(frozen);
  const second = parsePaperState(frozen);
  expect(first).toStrictEqual(second);
  first.territory[0] = 1;
  expect(second.territory[0]).toBe(-1);
  expect(parsePaperState(frozen).territory[0]).toBe(-1);
  const invalid = init();
  invalid.territory[0] = 99;
  Object.freeze(invalid.territory);
  expect(() => parsePaperState(invalid)).toThrow();
  const mutable = init();
  parsePaperState(mutable);
  mutable.trails[0] = 99;
  expect(() => parsePaperState(mutable)).toThrow();
  const inconsistent = { ...frozen, players: frozen.players.map((p) => ({ ...p, id: "same" })) };
  expect(() => parsePaperState(inconsistent)).toThrow();
});

test("engine snapshots share validated grids read-only; invalid snapshot grids still fail", () => {
  const snapshot = snapshotJson(init());
  const observation = required(paperRules.observe(snapshot, "alpha"));
  expect(observation.board.territory).toBe(snapshot.territory);
  expect(() => {
    observation.board.trails[0] = 0;
  }).toThrow(TypeError);
  const context = {
    config: paperManifest.config,
    players: snapshot.players,
    playerId: "alpha",
    tick: 0,
  };
  const parsed = paperGame.parseObservation(snapshotJson(observation), context);
  expect(parsed.board.trails).toBe(snapshot.trails);
  expect(paperGame.parseState(snapshot, context).territory).toBe(snapshot.territory);
  // Detached callers keep their own mutable copies.
  expect(parsePaperState(snapshot).territory).not.toBe(snapshot.territory);
  const invalid = init();
  invalid.trails[0] = 7;
  expect(() => paperRules.observe(snapshotJson(invalid), "alpha")).toThrow();
});

test("step requires every active player's canonical action and rejects extras", () => {
  for (const raw of [
    {},
    { alpha: idle() },
    { ...actions(), other: idle() },
    { alpha: { type: "move", direction: "oops" }, beta: idle() },
    { alpha: { type: "idle", extra: 1 }, beta: idle() },
  ]) {
    expect(() => stepUnknown(deepFreeze(init()), raw)).toThrow();
  }
  const initial = init();
  const reversed = { beta: idle(), alpha: move("right") };
  expect(stepFrozen(initial, actions(move("right")))).toStrictEqual(stepFrozen(initial, reversed));
});

test("player IDs which overlap object prototypes are handled as ordinary own keys", () => {
  const state = paperRules.init({
    seed: 2,
    config: { ...paperManifest.config },
    players: [
      { id: "__proto__", slot: 0 },
      { id: "constructor", slot: 1 },
    ],
  });
  const output = stepFrozen(
    state,
    Object.fromEntries([
      ["__proto__", idle()],
      ["constructor", idle()],
    ]),
  );
  expect(output.nextState.tick).toBe(1);
  expect(output.result).toBe(undefined);
});

test("idle outside preserves the head trail without self collision or a move event", () => {
  const state = outside(world(), 0, [[5, 5]]);
  const output = stepFrozen(state, actions());
  expect(output.nextState.players[0].alive).toBe(true);
  expect(output.nextState.trails.filter((owner) => owner === 0).length).toBe(1);
  expect(output.events).toStrictEqual([]);
  expect(output.nextState.tick).toBe(1);
});

for (const [direction, x, y] of [
  ["up", 5, 4],
  ["right", 6, 5],
  ["down", 5, 6],
  ["left", 4, 5],
] as const) {
  test(`movement ${direction} advances exactly one cell and emits a detached move event`, () => {
    const output = stepFrozen(world(), actions(move(direction)));
    expect(output.nextState.players[0].position).toStrictEqual({ x, y });
    expect(output.nextState.trails[y * 30 + x]).toBe(0);
    expect(output.events).toStrictEqual([
      { type: "move", playerId: "alpha", from: { x: 5, y: 5 }, to: { x, y } },
    ]);
    eventOf(output, "move").to.x = 39;
    expect(required(output.nextState.players[0].position).x).toBe(x);
    expect(parsePaperState(output.nextState)).toStrictEqual(output.nextState);
  });
}

test("shared immutable observations keep identity and world validation at each boundary", () => {
  const state = snapshotJson(init());
  const first = snapshotJson(required(paperRules.observe(state, "alpha")));
  const second = snapshotJson(required(paperRules.observe(state, "beta")));
  expect(first.board).toBe(second.board);
  expect(first.players).toBe(second.players);
  const context = {
    config: paperManifest.config,
    players: state.players,
    tick: 0,
    playerId: "alpha",
  };
  paperGame.parseObservation(first, context);
  expect(paperGame.parseObservation(second, { ...context, playerId: "beta" }).selfSlot).toBe(1);
  expect(() =>
    paperGame.parseObservation(snapshotJson({ ...second, selfId: "alpha" }), {
      ...context,
      playerId: "alpha",
    }),
  ).toThrow(/identity/);
  expect(() =>
    paperGame.parseObservation(
      snapshotJson({
        ...first,
        players: first.players.map((p) => ({ ...p, position: { x: -1, y: 0 } })),
      }),
      context,
    ),
  ).toThrow();
  expect(() =>
    paperGame.parseObservation(snapshotJson({ ...first, events: [{ type: "unknown" }] }), context),
  ).toThrow();
  const copy = parsePaperState(state);
  required(copy.players[0].position).x++;
  copy.spawns[0].x++;
  copy.territory[0] = 0;
  expect(parsePaperState(state)).toEqual(state);
  expect(() =>
    parsePaperState(
      snapshotJson({ ...state, players: [{ ...state.players[0], id: "beta" }, state.players[1]] }),
    ),
  ).toThrow();
});
