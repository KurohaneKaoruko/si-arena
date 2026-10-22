import { expect, test } from "vitest";
import { collapsedRings, ringOf } from "@si-arena/game-bomber";
import type { BomberState } from "@si-arena/game-bomber/sdk";
import { bomberRules, bomberCollapse } from "@si-arena/game-bomber/rules";
import type { Cell } from "./helpers";
import {
  bomb,
  collapseTo,
  deaths,
  eliminate,
  eventsOf,
  idle,
  index,
  init,
  move,
  placeBomb,
  powerup,
  ranks,
  required,
  resultOf,
  scores,
  step,
  wall,
  world,
} from "./helpers";

const CORNERS = ["0,0", "14,0", "0,12", "14,12"];
const at = (state: BomberState, slot: number) => {
  const { x, y } = required(state.players[slot]!.position);
  return `${x},${y}`;
};
const isPillar = (x: number, y: number) => x % 2 === 1 && y % 2 === 1;
const isProtected = (x: number, y: number) => {
  const mx = Math.min(x, 14 - x);
  const my = Math.min(y, 12 - y);
  return (mx <= 2 && my === 0) || (mx === 0 && my <= 2);
};

test("the fixed map has pillars on odd coordinates, protected corners and four-way mirrored walls", () => {
  let eligible = 0;
  let walls = 0;
  const items = [0, 0, 0];
  const orders = new Set<string>();
  for (let seed = 0; seed < 200; seed++) {
    const state = init(4, seed);
    expect([state.width, state.height, state.tick, state.maxTicks]).toStrictEqual([15, 13, 0, 400]);
    expect(state.bombs).toStrictEqual([]);
    expect(state.powerups).toStrictEqual([]);
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 15; x++) {
        const cell = state.cells[y * 15 + x]!;
        const hidden = state.hidden[y * 15 + x]!;
        if (isPillar(x, y)) expect(cell).toBe(1);
        else {
          expect(cell === 0 || cell === 2).toBe(true);
          if (isProtected(x, y)) expect(cell).toBe(0);
          else {
            eligible++;
            if (cell === 2) walls++;
          }
        }
        if (cell !== 2) expect(hidden).toBe(0);
        else items[hidden]!++;
        for (const [mx, my] of [
          [14 - x, y],
          [x, 12 - y],
          [14 - x, 12 - y],
        ] as const) {
          expect(state.cells[my * 15 + mx]).toBe(cell);
          expect(state.hidden[my * 15 + mx]).toBe(hidden);
        }
      }
    }
    const spawns = state.players.map((player) => at(state, player.slot));
    expect(new Set(spawns).size).toBe(4);
    for (const spawn of spawns) expect(CORNERS).toContain(spawn);
    orders.add(spawns.join(" "));
    for (const player of state.players) {
      expect(player).toMatchObject({ bombsMax: 1, fireRange: 2, score: 0, death: null });
    }
  }
  expect(Math.abs(walls / eligible - 0.7)).toBeLessThan(0.03);
  const total = items[0]! + items[1]! + items[2]!;
  expect(Math.abs(items[1]! / total - 0.2)).toBeLessThan(0.05);
  expect(Math.abs(items[2]! / total - 0.2)).toBeLessThan(0.05);
  expect(orders.size, "the seed shuffles seats across the corners").toBeGreaterThan(4);
  expect(init(4, 0)).toStrictEqual(init(4, 0x9e3779b9));
  expect(init(4, 1)).not.toStrictEqual(init(4, 2));
  // Fewer players take the first corners of the same shuffle; the map does not change.
  const four = init(4, 5);
  const two = init(2, 5);
  expect(two.cells).toStrictEqual(four.cells);
  expect(two.players.map((p) => p.position)).toStrictEqual(
    four.players.slice(0, 2).map((p) => p.position),
  );
});

test("moves are blocked by the edge, pillars, walls, bombs and collapsed cells, never by players", () => {
  const edge = step(
    world([
      [0, 0],
      [14, 12],
    ]),
    { 0: move("left"), 1: move("down") },
  );
  expect(eventsOf(edge, "move")).toStrictEqual([]);
  expect(at(edge.nextState, 0)).toBe("0,0");
  const pillar = step(
    world([
      [0, 1],
      [14, 12],
    ]),
    { 0: move("right") },
  );
  expect(at(pillar.nextState, 0)).toBe("0,1");
  const walled = step(
    wall(
      world([
        [0, 0],
        [14, 12],
      ]),
      [1, 0],
    ),
    { 0: move("right") },
  );
  expect(at(walled.nextState, 0)).toBe("0,0");
  const bombed = step(
    placeBomb(
      world([
        [0, 0],
        [14, 12],
      ]),
      1,
      [1, 0],
      5,
    ),
    { 0: move("right") },
  );
  expect(at(bombed.nextState, 0)).toBe("0,0");
  const collapsed = step(
    collapseTo(
      world([
        [1, 2],
        [12, 10],
      ]),
      301,
    ),
    { 0: move("left") },
  );
  expect(at(collapsed.nextState, 0)).toBe("1,2");
  const free = step(
    world([
      [0, 0],
      [14, 12],
    ]),
    { 0: move("right"), 1: move("up") },
  );
  expect(eventsOf(free, "move")).toStrictEqual([
    { type: "move", playerId: "alpha", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    { type: "move", playerId: "beta", from: { x: 14, y: 12 }, to: { x: 14, y: 11 } },
  ]);
  const swap = step(
    world([
      [2, 0],
      [3, 0],
    ]),
    { 0: move("right"), 1: move("left") },
  );
  expect([at(swap.nextState, 0), at(swap.nextState, 1)]).toStrictEqual(["3,0", "2,0"]);
  const meet = step(
    world([
      [2, 0],
      [4, 0],
    ]),
    { 0: move("right"), 1: move("left") },
  );
  expect([at(meet.nextState, 0), at(meet.nextState, 1)]).toStrictEqual(["3,0", "3,0"]);
});

test("a bomb drops under its placer with a 7-tick fuse, once per cell and within the limit", () => {
  const placed = step(
    world([
      [0, 0],
      [14, 12],
    ]),
    { 0: bomb() },
  );
  expect(placed.nextState.bombs).toStrictEqual([
    { position: { x: 0, y: 0 }, owner: 0, fuse: 7, range: 2 },
  ]);
  expect(eventsOf(placed, "bomb-placed")).toStrictEqual([
    { type: "bomb-placed", playerId: "alpha", position: { x: 0, y: 0 } },
  ]);
  // Standing on the bomb, and at the limit after leaving it.
  const again = step(placed.nextState, { 0: bomb() });
  expect(again.nextState.bombs).toHaveLength(1);
  const away = step(placed.nextState, { 0: move("right") });
  const limited = step(away.nextState, { 0: bomb() });
  expect(limited.nextState.bombs).toHaveLength(1);
  expect(eventsOf(limited, "bomb-placed")).toStrictEqual([]);
  away.nextState.players[0]!.bombsMax = 2;
  const second = step(away.nextState, { 0: bomb() });
  expect(second.nextState.bombs.map((b) => b.position)).toStrictEqual([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ]);
  // Two players on one cell: the lower slot's bomb lands.
  const shared = step(
    world([
      [3, 0],
      [3, 0],
    ]),
    { 0: bomb(), 1: bomb() },
  );
  expect(shared.nextState.bombs.map((b) => b.owner)).toStrictEqual([0]);
  expect(eventsOf(shared, "bomb-placed").map((e) => e.playerId)).toStrictEqual(["alpha"]);
  // The range follows the placer's current fire range.
  const strong = world([
    [0, 0],
    [14, 12],
  ]);
  strong.players[0]!.fireRange = 5;
  expect(step(strong, { 0: bomb() }).nextState.bombs[0]!.range).toBe(5);
});

test("flames reach `range` cells, stop before pillars and the edge, and on a wall", () => {
  const open = step(
    placeBomb(
      world([
        [0, 12],
        [14, 12],
      ]),
      0,
      [4, 0],
      1,
      2,
    ),
  );
  expect(eventsOf(open, "explosion")).toStrictEqual([
    {
      type: "explosion",
      bombs: [{ position: { x: 4, y: 0 }, ownerId: "alpha" }],
      cells: [2, 3, 4, 5, 6, 19, 34],
      destroyed: [],
    },
  ]);
  expect(open.nextState.bombs).toStrictEqual([]);
  const boxed = step(
    placeBomb(
      world([
        [0, 12],
        [14, 12],
      ]),
      0,
      [2, 1],
      1,
      3,
    ),
  );
  expect(eventsOf(boxed, "explosion")[0]!.cells).toStrictEqual([2, 17, 32, 47, 62]);
  const state = wall(
    wall(
      placeBomb(
        world([
          [0, 12],
          [14, 12],
        ]),
        0,
        [4, 0],
        1,
        3,
      ),
      [6, 0],
    ),
    [4, 2],
  );
  const walled = step(state);
  expect(eventsOf(walled, "explosion")[0]).toMatchObject({
    cells: [1, 2, 3, 4, 5, 6, 19, 34],
    destroyed: [6, 34],
  });
  expect(walled.nextState.cells[6]).toBe(0);
  expect(walled.nextState.cells[34]).toBe(0);
  expect(scores(walled.nextState)).toStrictEqual([2, 0]);
});

test("walls reveal their item, items already lying in the fire burn, and a wall still blocks the tick it falls", () => {
  const state = wall(
    placeBomb(
      world([
        [0, 12],
        [14, 12],
      ]),
      0,
      [4, 0],
      1,
      2,
    ),
    [6, 0],
    1,
  );
  powerup(state, [2, 0], "bomb");
  const output = step(state);
  expect(output.nextState.powerups).toStrictEqual([{ position: { x: 6, y: 0 }, kind: "fire" }]);
  expect(output.nextState.hidden[6]).toBe(0);
  // A second bomb beyond the wall: its ray reaches the wall too but the earlier bomb is credited,
  // and neither ray passes the wall within this tick.
  const twin = wall(
    world([
      [0, 12],
      [14, 12],
    ]),
    [5, 0],
  );
  placeBomb(twin, 1, [6, 0], 1, 2);
  placeBomb(twin, 0, [4, 0], 1, 2);
  const both = step(twin);
  expect(eventsOf(both, "explosion")[0]).toMatchObject({
    bombs: [
      { position: { x: 6, y: 0 }, ownerId: "beta" },
      { position: { x: 4, y: 0 }, ownerId: "alpha" },
    ],
    destroyed: [5],
  });
  expect(scores(both.nextState)).toStrictEqual([0, 1]);
  const empty = wall(
    placeBomb(
      world([
        [0, 12],
        [14, 12],
      ]),
      0,
      [4, 0],
      1,
      2,
    ),
    [6, 0],
    0,
  );
  expect(step(empty).nextState.powerups).toStrictEqual([]);
});

test("flames set off every bomb they reach in the same tick, including one placed this tick", () => {
  const state = placeBomb(
    placeBomb(
      world([
        [0, 12],
        [14, 12],
      ]),
      0,
      [4, 0],
      1,
      2,
    ),
    1,
    [6, 0],
    5,
    2,
  );
  placeBomb(state, 0, [8, 0], 7, 2);
  placeBomb(state, 1, [12, 0], 7, 2);
  state.players[0]!.bombsMax = 2;
  state.players[1]!.bombsMax = 2;
  const output = step(state);
  expect(eventsOf(output, "explosion")[0]!.bombs.map((b) => b.position.x)).toStrictEqual([4, 6, 8]);
  expect(output.nextState.bombs.map((b) => [b.position.x, b.fuse])).toStrictEqual([[12, 6]]);
  const fresh = placeBomb(
    world([
      [6, 0],
      [14, 12],
    ]),
    1,
    [4, 0],
    1,
    2,
  );
  const chained = step(fresh, { 0: bomb() });
  expect(eventsOf(chained, "explosion")[0]!.bombs.map((b) => b.ownerId)).toStrictEqual([
    "beta",
    "alpha",
  ]);
  expect(deaths(chained)).toStrictEqual([["alpha", ["flame"]]]);
  expect(eventsOf(chained, "death")[0]!.killerIds).toStrictEqual(["beta"]);
});

test("standing in or stepping into flames kills; the covering bombs' owners score ten per bomb", () => {
  const standing = step(
    placeBomb(
      world([
        [3, 0],
        [14, 12],
      ]),
      1,
      [4, 0],
      1,
      2,
    ),
  );
  expect(deaths(standing)).toStrictEqual([["alpha", ["flame"]]]);
  expect(eventsOf(standing, "death")[0]).toMatchObject({
    position: { x: 3, y: 0 },
    killerIds: ["beta"],
  });
  expect(standing.nextState.players[0]).toMatchObject({
    position: null,
    death: { tick: 1, causes: ["flame"] },
    score: 0,
  });
  expect(scores(standing.nextState)).toStrictEqual([0, 10]);
  expect(resultOf(standing)).toMatchObject({ reason: "elimination", completedTicks: 1 });
  const entering = step(
    placeBomb(
      world([
        [1, 0],
        [14, 12],
      ]),
      1,
      [4, 0],
      1,
      2,
    ),
    { 0: move("right") },
  );
  expect(deaths(entering)).toStrictEqual([["alpha", ["flame"]]]);
  const leaving = step(
    placeBomb(
      world([
        [4, 2],
        [14, 12],
      ]),
      1,
      [4, 0],
      1,
      2,
    ),
    { 0: move("right") },
  );
  expect(deaths(leaving)).toStrictEqual([]);
  const own = step(
    placeBomb(
      world([
        [3, 0],
        [14, 12],
      ]),
      0,
      [4, 0],
      1,
      2,
    ),
  );
  expect(eventsOf(own, "death")[0]!.killerIds).toStrictEqual([]);
  expect(scores(own.nextState)).toStrictEqual([0, 0]);
  const twice = placeBomb(
    placeBomb(
      world([
        [3, 0],
        [14, 12],
      ]),
      1,
      [4, 0],
      1,
      2,
    ),
    1,
    [2, 0],
    1,
    2,
  );
  twice.players[1]!.bombsMax = 2;
  const double = step(twice);
  expect(eventsOf(double, "death")[0]!.killerIds).toStrictEqual(["beta"]);
  expect(scores(double.nextState)).toStrictEqual([0, 20]);
});

test("players dying together tie, and a dead player's bombs keep exploding for no points", () => {
  const together = step(
    placeBomb(
      world([
        [3, 0],
        [5, 0],
        [14, 12],
      ]),
      2,
      [4, 0],
      1,
      2,
    ),
  );
  expect(deaths(together)).toStrictEqual([
    ["alpha", ["flame"]],
    ["beta", ["flame"]],
  ]);
  expect(ranks(together)).toStrictEqual([
    [2, 0, false],
    [2, 0, false],
    [1, 20, true],
  ]);
  const legacy = placeBomb(
    world([
      [1, 0],
      [0, 12],
      [3, 2],
    ]),
    0,
    [4, 2],
    2,
    2,
  );
  placeBomb(legacy, 1, [0, 0], 1, 2);
  const first = step(legacy);
  expect(deaths(first)).toStrictEqual([["alpha", ["flame"]]]);
  expect(first.nextState.bombs).toStrictEqual([
    { position: { x: 4, y: 2 }, owner: 0, fuse: 1, range: 2 },
  ]);
  const second = step(first.nextState);
  expect(deaths(second)).toStrictEqual([["gamma", ["flame"]]]);
  expect(eventsOf(second, "death")[0]!.killerIds).toStrictEqual(["alpha"]);
  expect(eventsOf(second, "explosion")[0]!.bombs).toStrictEqual([
    { position: { x: 4, y: 2 }, ownerId: "alpha" },
  ]);
  expect(scores(second.nextState)).toStrictEqual([0, 10, 0]);
  expect(ranks(second)).toStrictEqual([
    [3, 0, false],
    [1, 10, true],
    [2, 0, false],
  ]);
});

test("powerups are picked up by everyone on the cell, capped at 8 fire and 6 bombs", () => {
  const fire = step(
    powerup(
      world([
        [0, 0],
        [14, 12],
      ]),
      [1, 0],
      "fire",
    ),
    { 0: move("right") },
  );
  expect(fire.nextState.players[0]).toMatchObject({ fireRange: 3, bombsMax: 1 });
  expect(fire.nextState.powerups).toStrictEqual([]);
  expect(eventsOf(fire, "pickup")).toStrictEqual([
    { type: "pickup", playerId: "alpha", kind: "fire", position: { x: 1, y: 0 } },
  ]);
  const shared = step(
    powerup(
      world([
        [0, 0],
        [2, 0],
      ]),
      [1, 0],
      "bomb",
    ),
    {
      0: move("right"),
      1: move("left"),
    },
  );
  expect(shared.nextState.players.map((p) => p.bombsMax)).toStrictEqual([2, 2]);
  expect(eventsOf(shared, "pickup").map((e) => e.playerId)).toStrictEqual(["alpha", "beta"]);
  const capped = powerup(
    powerup(
      world([
        [0, 0],
        [14, 12],
      ]),
      [1, 0],
      "fire",
    ),
    [2, 0],
    "bomb",
  );
  capped.players[0]!.fireRange = 8;
  capped.players[0]!.bombsMax = 6;
  const one = step(capped, { 0: move("right") });
  const two = step(one.nextState, { 0: move("right") });
  expect(two.nextState.players[0]).toMatchObject({ fireRange: 8, bombsMax: 6 });
  expect(two.nextState.powerups).toStrictEqual([]);
});

test("the collapse schedule is published and rings fall from tick 300 every eight ticks", () => {
  expect([0, 299, 300, 307, 308, 339, 340, 399].map(collapsedRings)).toStrictEqual([
    0, 0, 1, 1, 2, 5, 6, 6,
  ]);
  expect([0, 299, 300, 339, 340].map(bomberCollapse)).toStrictEqual([
    { startTick: 300, interval: 8, nextRing: 0, ticksToNextCollapse: 300 },
    { startTick: 300, interval: 8, nextRing: 0, ticksToNextCollapse: 1 },
    { startTick: 300, interval: 8, nextRing: 1, ticksToNextCollapse: 8 },
    { startTick: 300, interval: 8, nextRing: 5, ticksToNextCollapse: 1 },
    { startTick: 300, interval: 8, nextRing: null, ticksToNextCollapse: null },
  ]);
  const observed = required(
    bomberRules.observe(
      collapseTo(
        world([
          [2, 2],
          [12, 10],
        ]),
        300,
      ),
      "alpha",
    ),
  );
  expect(observed.collapse).toStrictEqual(bomberCollapse(300));
  const ring0: number[] = [];
  for (let cell = 0; cell < 195; cell++)
    if (ringOf(cell % 15, Math.floor(cell / 15)) === 0) ring0.push(cell);
  expect(ring0).toHaveLength(52);
  const state = collapseTo(
    wall(
      world([
        [2, 2],
        [12, 10],
      ]),
      [5, 0],
      1,
    ),
    299,
  );
  placeBomb(state, 0, [0, 5], 4, 2);
  powerup(state, [3, 0], "fire");
  const output = step(state);
  expect(eventsOf(output, "collapse")).toStrictEqual([{ type: "collapse", ring: 0, cells: ring0 }]);
  expect(ring0.every((cell) => output.nextState.cells[cell] === 3)).toBe(true);
  expect(output.nextState.hidden[5]).toBe(0);
  expect(output.nextState.bombs).toStrictEqual([]);
  expect(output.nextState.powerups).toStrictEqual([]);
  expect(deaths(output)).toStrictEqual([]);
  expect(eventsOf(step(output.nextState), "collapse")).toStrictEqual([]);
});

test("collapse crushes players, also together with flames, and never reaches the centre", () => {
  const crushed = step(
    collapseTo(
      world([
        [0, 5],
        [12, 10],
      ]),
      299,
    ),
  );
  expect(deaths(crushed)).toStrictEqual([["alpha", ["collapse"]]]);
  expect(eventsOf(crushed, "death")[0]).toMatchObject({ position: { x: 0, y: 5 }, killerIds: [] });
  const both = step(
    placeBomb(
      collapseTo(
        world([
          [0, 5],
          [12, 10],
        ]),
        299,
      ),
      1,
      [0, 4],
      1,
      2,
    ),
  );
  expect(deaths(both)).toStrictEqual([["alpha", ["flame", "collapse"]]]);
  expect(both.nextState.players[0]!.death).toStrictEqual({
    tick: 300,
    causes: ["flame", "collapse"],
  });
  let state = collapseTo(
    world([
      [6, 6],
      [8, 6],
    ]),
    339,
  );
  let output = step(state);
  expect(eventsOf(output, "collapse")[0]).toMatchObject({ ring: 5 });
  expect(deaths(output)).toStrictEqual([]);
  const centre = [index(state, [6, 6]), index(state, [7, 6]), index(state, [8, 6])];
  expect(output.nextState.cells.filter((cell) => cell !== 3)).toHaveLength(3);
  expect(centre.map((cell) => output.nextState.cells[cell])).toStrictEqual([0, 0, 0]);
  state = output.nextState;
  while (!output.result) {
    output = step(state);
    expect(eventsOf(output, "collapse")).toStrictEqual([]);
    state = output.nextState;
  }
  expect(resultOf(output)).toMatchObject({ reason: "tick-limit", completedTicks: 400 });
});

test("four idle players all die when ring 0 collapses and share first place", () => {
  let state = init(4, 42);
  let output = step(state);
  while (!output.result) {
    state = output.nextState;
    output = step(state);
  }
  expect(resultOf(output)).toMatchObject({ reason: "elimination", completedTicks: 300 });
  expect(ranks(output)).toStrictEqual(Array.from({ length: 4 }, () => [1, 0, false]));
  expect(deaths(output).map(([, causes]) => causes)).toStrictEqual([
    ["collapse"],
    ["collapse"],
    ["collapse"],
    ["collapse"],
  ]);
});

test("at the tick limit survivors rank by score with ties, the dead by death tick", () => {
  const state = eliminate(
    eliminate(
      world([
        [6, 6],
        [8, 6],
        [6, 5],
        [8, 5],
      ]),
      2,
      10,
    ),
    3,
    20,
  );
  state.players[0]!.score = 5;
  state.players[1]!.score = 5;
  collapseTo(state, 399);
  const output = step(state);
  expect(resultOf(output)).toMatchObject({ reason: "tick-limit", completedTicks: 400 });
  expect(ranks(output)).toStrictEqual([
    [1, 5, true],
    [1, 5, true],
    [4, 0, false],
    [3, 0, false],
  ]);
  const uneven = world([
    [6, 6],
    [8, 6],
  ]);
  uneven.players[1]!.score = 7;
  collapseTo(uneven, 399);
  expect(ranks(step(uneven))).toStrictEqual([
    [2, 0, true],
    [1, 7, true],
  ]);
  const everyone = step(
    placeBomb(
      world([
        [3, 0],
        [5, 0],
      ]),
      0,
      [4, 0],
      1,
      2,
    ),
  );
  expect(resultOf(everyone)).toMatchObject({ reason: "elimination", completedTicks: 1 });
  expect(ranks(everyone)).toStrictEqual([
    [1, 0, false],
    [1, 0, false],
  ]);
  expect(() => bomberRules.step(everyone.nextState, {})).toThrow(/finished/);
  expect(bomberRules.observe(everyone.nextState, "alpha")).toBe(null);
  const limit = collapseTo(
    world([
      [6, 6],
      [8, 6],
    ]),
    400,
  );
  expect(() => bomberRules.step(limit, { alpha: idle(), beta: idle() })).toThrow(/finished/);
});

test("the eliminated receive no observation and the living see them listed", () => {
  const output = step(
    placeBomb(
      world([
        [3, 0],
        [14, 12],
        [0, 12],
      ]),
      1,
      [4, 0],
      1,
      2,
    ),
  );
  expect(bomberRules.observe(output.nextState, "alpha")).toBe(null);
  const observed = required(
    bomberRules.observe(output.nextState, "beta", { events: output.events }),
  );
  expect(observed.eliminated).toStrictEqual([{ id: "alpha", slot: 0, tick: 1, causes: ["flame"] }]);
  expect(observed.players.map((p) => [p.id, p.activeBombs, p.score])).toStrictEqual([
    ["beta", 0, 10],
    ["gamma", 0, 0],
  ]);
  expect(observed.events).toStrictEqual(output.events);
  const cells: Cell[] = [
    [0, 0],
    [14, 12],
  ];
  expect(required(bomberRules.observe(world(cells), "alpha")).collapse).toStrictEqual(
    bomberCollapse(0),
  );
});
