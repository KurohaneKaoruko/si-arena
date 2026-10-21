import { expect, test } from "vitest";
import { royaleMapSize } from "@si-arena/game-royale";
import type { RoyaleState } from "@si-arena/game-royale/sdk";
import { royaleRules } from "@si-arena/game-royale/rules";
import type { Cell } from "./helpers";
import {
  areaOf,
  deaths,
  eliminate,
  eventsOf,
  excursion,
  idle,
  index,
  init,
  move,
  ranks,
  required,
  resultOf,
  step,
  trailOf,
  world,
} from "./helpers";

/** A home column at x = left and a trail around the box; moving left closes it. */
function box(
  state: RoyaleState,
  slot: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  const home: Cell[] = [];
  const trail: Cell[] = [];
  for (let y = top; y <= bottom; y++) home.push([left, y]);
  for (let x = left + 1; x <= right; x++) trail.push([x, top]);
  for (let y = top + 1; y <= bottom; y++) trail.push([right, y]);
  for (let x = right - 1; x > left; x--) trail.push([x, bottom]);
  return excursion(state, slot, trail, home);
}

test("the map side follows the player count and the zone starts as the whole map", () => {
  expect([2, 3, 4, 5].map(royaleMapSize)).toStrictEqual([26, 31, 36, 40]);
  for (const players of [2, 3, 4, 5]) {
    const state = init(players);
    expect(state.width).toBe(royaleMapSize(players));
    expect(state.height).toBe(state.width);
    expect(state.zoneSize).toBe(state.width);
    expect(state.tick).toBe(0);
    expect(state.trails.every((owner) => owner === -1)).toBe(true);
    for (const player of state.players) {
      expect(player.position).toStrictEqual(player.spawn);
      expect(player.death).toBe(null);
      expect(areaOf(state, player.slot)).toBe(9);
    }
  }
});

test("spawns sit on the seeded circle, inside the map, with separate 3×3 homes and shuffled seats", () => {
  for (const players of [2, 3, 4, 5]) {
    const orders = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const state = init(players, seed);
      const side = state.width;
      const spawns = state.players.map((player) => player.spawn);
      for (const [order, spawn] of spawns.entries()) {
        expect(spawn.x).toBeGreaterThanOrEqual(1);
        expect(spawn.y).toBeGreaterThanOrEqual(1);
        expect(spawn.x).toBeLessThanOrEqual(side - 2);
        expect(spawn.y).toBeLessThanOrEqual(side - 2);
        const radius = Math.hypot(spawn.x + 0.5 - side / 2, spawn.y + 0.5 - side / 2);
        expect(Math.abs(radius - 0.32 * side)).toBeLessThan(1);
        for (const other of spawns.slice(order + 1))
          expect(
            Math.max(Math.abs(spawn.x - other.x), Math.abs(spawn.y - other.y)),
          ).toBeGreaterThanOrEqual(3);
      }
      const angle = (slot: number) => {
        const spawn = spawns[slot]!;
        return Math.atan2(spawn.y - side / 2, spawn.x - side / 2);
      };
      const around = spawns.map((_, slot) => slot).toSorted((a, b) => angle(a) - angle(b));
      const start = around.indexOf(0);
      orders.add([...around.slice(start), ...around.slice(0, start)].join());
    }
    if (players > 2)
      expect(orders.size, "the seed shuffles seats around the circle").toBeGreaterThan(1);
  }
  expect(init(5, 0)).toStrictEqual(init(5, 0x9e3779b9));
  expect(init(5, 1)).not.toStrictEqual(init(5, 2));
});

test("moving off the map kills the player, clears its land and keeps the others playing", () => {
  const state = world([
    [0, 5],
    [10, 10],
    [25, 25],
  ]);
  state.territory[index(state, [1, 5])] = 0;
  const output = step(state, { 0: move("left") });
  expect(deaths(output)).toStrictEqual([["alpha", ["boundary"]]]);
  expect(eventsOf(output, "death")[0]?.position).toStrictEqual({ x: 0, y: 5 });
  const alpha = output.nextState.players[0]!;
  expect(alpha.position).toBe(null);
  expect(alpha.death).toStrictEqual({ tick: 1, causes: ["boundary"] });
  expect(areaOf(output.nextState, 0)).toBe(0);
  expect(output.result).toBe(undefined);
  expect(royaleRules.observe(output.nextState, "alpha")).toBe(null);
  expect(royaleRules.observe(output.nextState, "beta")?.eliminated).toStrictEqual([
    { id: "alpha", slot: 0, tick: 1, causes: ["boundary"] },
  ]);
});

test("heads entering one cell die together, including a move into an idle head", () => {
  const meeting = step(
    world([
      [5, 5],
      [7, 5],
      [25, 25],
    ]),
    { 0: move("right"), 1: move("left") },
  );
  expect(deaths(meeting)).toStrictEqual([
    ["alpha", ["head-collision"]],
    ["beta", ["head-collision"]],
  ]);
  const intoIdle = step(
    world([
      [5, 5],
      [6, 5],
      [25, 25],
    ]),
    { 0: move("right"), 1: idle() },
  );
  expect(deaths(intoIdle)).toStrictEqual([
    ["alpha", ["head-collision"]],
    ["beta", ["head-collision"]],
  ]);
});

test("two heads swapping cells die, a head moving into a vacated cell does not", () => {
  const swap = step(
    world([
      [5, 5],
      [6, 5],
      [25, 25],
    ]),
    { 0: move("right"), 1: move("left") },
  );
  expect(deaths(swap)).toStrictEqual([
    ["alpha", ["head-swap"]],
    ["beta", ["head-swap"]],
  ]);
  const follow = step(
    world([
      [5, 5],
      [6, 5],
      [25, 25],
    ]),
    { 0: move("right"), 1: move("right") },
  );
  expect(deaths(follow)).toStrictEqual([]);
  expect(follow.nextState.players.map((player) => player.position)).toStrictEqual([
    { x: 6, y: 5 },
    { x: 7, y: 5 },
    { x: 25, y: 25 },
  ]);
});

test("entering the own trail kills; idling on the own head trail cell does not", () => {
  const state = excursion(
    world([
      [2, 2],
      [20, 20],
      [25, 25],
    ]),
    0,
    [
      [5, 5],
      [6, 5],
      [6, 6],
      [5, 6],
    ],
    [[4, 5]],
  );
  expect(deaths(step(state, { 0: idle() }))).toStrictEqual([]);
  expect(deaths(step(state, { 0: move("up") }))).toStrictEqual([["alpha", ["self-trail"]]]);
});

test("stepping on a trail kills its owner and the attacker lays its own trail there", () => {
  const state = excursion(
    world([
      [11, 11],
      [20, 20],
      [25, 25],
    ]),
    1,
    [
      [10, 10],
      [11, 10],
      [12, 10],
    ],
    [[9, 10]],
  );
  const output = step(state, { 0: move("up") });
  expect(eventsOf(output, "trail-cut")).toStrictEqual([
    { type: "trail-cut", playerId: "beta", attackerId: "alpha", position: { x: 11, y: 10 } },
  ]);
  expect(deaths(output)).toStrictEqual([["beta", ["trail-cut"]]]);
  expect(trailOf(output.nextState, 0)).toStrictEqual([index(state, [11, 10])]);
  expect(trailOf(output.nextState, 1)).toStrictEqual([]);
  expect(areaOf(output.nextState, 1)).toBe(0);
});

test("a cut counts even when the attacker dies on the same tick, and causes accumulate", () => {
  const state = excursion(
    world([
      [11, 11],
      [20, 20],
      [11, 9],
    ]),
    1,
    [
      [10, 10],
      [11, 10],
      [12, 10],
    ],
    [[9, 10]],
  );
  // All three heads target one cell of beta's trail: alpha and gamma cut it, and beta
  // also turns back into it.
  const output = step(state, { 0: move("up"), 1: move("left"), 2: move("down") });
  expect(eventsOf(output, "trail-cut").map((event) => event.attackerId)).toStrictEqual([
    "alpha",
    "gamma",
  ]);
  expect(deaths(output)).toStrictEqual([
    ["alpha", ["head-collision"]],
    ["beta", ["head-collision", "self-trail", "trail-cut"]],
    ["gamma", ["head-collision"]],
  ]);
  expect(resultOf(output).reason).toBe("elimination");
  expect(ranks(output)).toStrictEqual([
    [1, 0, false],
    [1, 0, false],
    [1, 0, false],
  ]);
});

test("a closer claims what it encloses and a foreign trail on a claimed cell dies", () => {
  const state = box(
    world([
      [2, 2],
      [4, 3],
      [0, 4],
    ]),
    0,
    2,
    2,
    6,
    6,
  );
  // Beta's trail lies inside alpha's loop; gamma's trail crosses alpha's existing land.
  excursion(
    state,
    1,
    [
      [4, 4],
      [4, 5],
    ],
    [[4, 3]],
  );
  excursion(
    state,
    2,
    [
      [1, 4],
      [2, 4],
    ],
    [[0, 4]],
  );
  const output = step(state, { 0: move("left") });
  expect(deaths(output)).toStrictEqual([["beta", ["enclosed"]]]);
  const capture = required(eventsOf(output, "capture")[0]);
  expect(capture.playerId).toBe("alpha");
  for (let y = 2; y <= 6; y++)
    for (let x = 2; x <= 6; x++) expect(output.nextState.territory[index(state, [x, y])]).toBe(0);
  expect(capture.cells).toContain(index(state, [4, 3]));
  expect(capture.cells).not.toContain(index(state, [2, 4]));
  expect(trailOf(output.nextState, 0)).toStrictEqual([]);
  expect(trailOf(output.nextState, 2)).toStrictEqual([index(state, [1, 4]), index(state, [2, 4])]);
});

test("cells claimed by several closers keep their owner while single claims change hands", () => {
  const state = box(
    world([
      [2, 2],
      [4, 4],
      [20, 20],
    ]),
    0,
    2,
    2,
    8,
    8,
  );
  box(state, 1, 4, 4, 6, 6);
  state.territory[index(state, [5, 5])] = 2;
  const output = step(state, { 0: move("left"), 1: move("left") });
  // Beta's whole loop is inside alpha's: its trail dies, its interior is contested.
  expect(deaths(output)).toStrictEqual([["beta", ["enclosed"]]]);
  const territory = output.nextState.territory;
  expect(territory[index(state, [5, 5])], "contested land keeps its owner").toBe(2);
  for (const cell of [
    [5, 4],
    [6, 4],
    [6, 5],
    [6, 6],
    [5, 6],
  ] as const)
    expect(territory[index(state, cell)], "contested trail cells stay as they were").toBe(-1);
  for (const cell of [
    [4, 4],
    [4, 5],
    [4, 6],
    [3, 3],
    [7, 7],
  ] as const)
    expect(territory[index(state, cell)], "cells only alpha claims are alpha's").toBe(0);
  expect(eventsOf(output, "capture").map((event) => event.playerId)).toStrictEqual([
    "alpha",
    "beta",
  ]);
  expect(eventsOf(output, "capture")[1]?.cells).toStrictEqual([]);
});

test("a head whose land is captured underneath survives with a one-cell trail", () => {
  const state = box(
    world([
      [2, 2],
      [20, 20],
      [5, 5],
    ]),
    0,
    2,
    2,
    8,
    8,
  );
  const output = step(state, { 0: move("left") });
  expect(deaths(output)).toStrictEqual([]);
  expect(output.nextState.territory[index(state, [5, 5])]).toBe(0);
  expect(trailOf(output.nextState, 2)).toStrictEqual([index(state, [5, 5])]);
  expect(areaOf(output.nextState, 2)).toBe(0);
});

test("the zone shrinks a ring on multiples of 10 while above target and kills heads left outside", () => {
  // Four seats on a 36 map with three alive: the target is 31.
  const state = world([
    [0, 10],
    [1, 12],
    [20, 20],
    [30, 30],
  ]);
  eliminate(state, 3, 1);
  state.territory[index(state, [35, 35])] = 2;
  state.tick = 8;
  const early = step(state);
  expect(early.nextState.zoneSize, "tick 9 is not a shrink tick").toBe(36);
  expect(royaleRules.observe(early.nextState, "beta")?.zone).toStrictEqual({
    size: 36,
    target: 31,
    min: { x: 0, y: 0 },
    ticksToNextShrink: 1,
  });
  const shrink = step(early.nextState);
  expect(shrink.nextState.zoneSize).toBe(34);
  expect(eventsOf(shrink, "zone-shrink")).toStrictEqual([{ type: "zone-shrink", size: 34 }]);
  expect(deaths(shrink)).toStrictEqual([["alpha", ["zone"]]]);
  expect(shrink.nextState.territory[index(state, [35, 35])], "land outside becomes neutral").toBe(
    -1,
  );
  expect(shrink.nextState.players[1]!.position, "the second ring is still inside").toStrictEqual({
    x: 1,
    y: 12,
  });
  // Two alive now: the target drops to 26 and the next shrink is ten ticks away.
  expect(royaleRules.observe(shrink.nextState, "beta")?.zone).toStrictEqual({
    size: 34,
    target: 26,
    min: { x: 1, y: 1 },
    ticksToNextShrink: 10,
  });
  const outside = step(shrink.nextState, { 1: move("left") });
  expect(deaths(outside)).toStrictEqual([["beta", ["zone"]]]);
  expect(resultOf(outside).reason).toBe("elimination");
});

test("a zone at or below its target never shrinks", () => {
  const state = init(2);
  state.tick = 9;
  const output = step(state);
  expect(output.nextState.zoneSize).toBe(26);
  expect(eventsOf(output, "zone-shrink")).toStrictEqual([]);
  expect(royaleRules.observe(output.nextState, "alpha")?.zone.ticksToNextShrink).toBe(null);
});

test("at the tick limit the living rank by area with ties, the dead after them", () => {
  const state = world([
    [5, 5],
    [10, 10],
    [15, 15],
    [20, 20],
  ]);
  for (const cell of [
    [5, 6],
    [5, 7],
  ] as const)
    state.territory[index(state, cell)] = 0;
  for (const cell of [
    [10, 11],
    [10, 12],
  ] as const)
    state.territory[index(state, cell)] = 1;
  eliminate(state, 3, 5);
  state.tick = 799;
  const output = step(state);
  expect(resultOf(output).reason).toBe("tick-limit");
  expect(resultOf(output).completedTicks).toBe(800);
  expect(ranks(output)).toStrictEqual([
    [1, 3, true],
    [1, 3, true],
    [3, 1, true],
    [4, 0, false],
  ]);
});

test("the last survivor wins and the eliminated rank by death tick, later first", () => {
  const state = world([
    [0, 5],
    [10, 10],
    [15, 15],
    [20, 20],
  ]);
  eliminate(state, 3, 3);
  eliminate(state, 2, 5);
  const output = step(state, { 0: move("left") });
  expect(resultOf(output)).toMatchObject({ reason: "elimination", completedTicks: 6 });
  expect(ranks(output)).toStrictEqual([
    [2, 0, false],
    [1, 1, true],
    [3, 0, false],
    [4, 0, false],
  ]);
  expect(royaleRules.observe(output.nextState, "beta")).toBe(null);
  expect(() => royaleRules.step(output.nextState, {})).toThrow(/finished/);
});

test("players dying on the same tick share a rank", () => {
  const output = step(
    world([
      [5, 5],
      [7, 5],
      [25, 25],
    ]),
    { 0: move("right"), 1: move("left") },
  );
  expect(ranks(output)).toStrictEqual([
    [2, 0, false],
    [2, 0, false],
    [1, 1, true],
  ]);
});

test("a total wipe ranks everyone first", () => {
  const output = step(
    world([
      [5, 5],
      [6, 5],
    ]),
    { 0: move("right"), 1: move("left") },
  );
  expect(resultOf(output).reason).toBe("elimination");
  expect(ranks(output)).toStrictEqual([
    [1, 0, false],
    [1, 0, false],
  ]);
});
