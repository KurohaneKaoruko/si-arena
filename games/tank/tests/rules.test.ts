import { expect, test } from "vitest";
import { TANK_SPAWNS } from "@si-arena/game-tank";
import { tankRules } from "@si-arena/game-tank/rules";
import {
  bullet,
  eventsOf,
  fire,
  hps,
  idle,
  index,
  init,
  move,
  positions,
  ranks,
  required,
  resultOf,
  step,
  world,
} from "./helpers";

test("every seed yields a point-symmetric map with empty, connected spawn areas", () => {
  for (let seed = 0; seed < 200; seed++) {
    const state = init(seed);
    expect([state.width, state.height, state.cells.length, state.tick]).toStrictEqual([
      21, 15, 315, 0,
    ]);
    for (let y = 0; y < 15; y++)
      for (let x = 0; x < 21; x++) {
        const cell = state.cells[y * 21 + x]!;
        expect([0, 1, 2]).toContain(cell);
        expect(cell, `seed ${seed} mirror of ${x},${y}`).toBe(state.cells[(14 - y) * 21 + 20 - x]);
      }
    for (const spawn of TANK_SPAWNS)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          expect(state.cells[(spawn.y + dy) * 21 + spawn.x + dx]).toBe(0);
    // Four-neighbour flood from spawn 0 over non-steel cells reaches spawn 1.
    const seen = new Set<number>([7 * 21 + 1]);
    const queue = [7 * 21 + 1];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const cell = queue[cursor]!;
      const x = cell % 21;
      for (const next of [cell - 21, cell + 21, x > 0 ? cell - 1 : -1, x < 20 ? cell + 1 : -1])
        if (next >= 0 && next < 315 && !seen.has(next) && state.cells[next] !== 2) {
          seen.add(next);
          queue.push(next);
        }
    }
    expect(seen.has(7 * 21 + 19), `seed ${seed} connected`).toBe(true);
    expect(
      state.tanks.map((tank) => [tank.position, tank.facing, tank.hp, tank.death]),
    ).toStrictEqual([
      [{ x: 1, y: 7 }, "right", 3, null],
      [{ x: 19, y: 7 }, "left", 3, null],
    ]);
    expect(state.bullets).toStrictEqual([]);
  }
  expect(init(3).cells).not.toStrictEqual(init(4).cells);
  expect(init(0).rngState).not.toBe(0);
});

test("a move turns first and then advances into a free cell", () => {
  const output = step(
    world([
      [[5, 5], "right"],
      [[15, 5], "left"],
    ]),
    { 0: move("up") },
  );
  expect(positions(output.nextState)).toStrictEqual([
    [5, 4],
    [15, 5],
  ]);
  expect(output.nextState.tanks[0]!.facing).toBe("up");
  expect(output.events).toStrictEqual([
    { type: "move", playerId: "alpha", from: { x: 5, y: 5 }, to: { x: 5, y: 4 }, facing: "up" },
  ]);
});

test("blocked moves still turn: edges, bricks, steel, the other tank, shared targets and swaps", () => {
  const edge = step(
    world([
      [[0, 0], "right"],
      [[15, 5], "left"],
    ]),
    { 0: move("left") },
  );
  expect(positions(edge.nextState)[0]).toStrictEqual([0, 0]);
  expect(eventsOf(edge, "move")[0]).toMatchObject({
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    facing: "left",
  });
  for (const kind of [1, 2] as const) {
    const wall = step(
      world(
        [
          [[5, 5], "right"],
          [[15, 5], "left"],
        ],
        { [6 * 21 + 5]: kind },
      ),
      {
        0: move("down"),
      },
    );
    expect(positions(wall.nextState)[0]).toStrictEqual([5, 5]);
    expect(wall.nextState.tanks[0]!.facing).toBe("down");
  }
  const intoTank = step(
    world([
      [[5, 5], "up"],
      [[6, 5], "up"],
    ]),
    { 0: move("right") },
  );
  expect(positions(intoTank.nextState)).toStrictEqual([
    [5, 5],
    [6, 5],
  ]);
  const intoFiring = step(
    world([
      [[5, 5], "up"],
      [[6, 5], "up"],
    ]),
    { 0: move("right"), 1: fire() },
  );
  expect(positions(intoFiring.nextState)).toStrictEqual([
    [5, 5],
    [6, 5],
  ]);
  const shared = step(
    world([
      [[5, 5], "up"],
      [[7, 5], "up"],
    ]),
    { 0: move("right"), 1: move("left") },
  );
  expect(positions(shared.nextState)).toStrictEqual([
    [5, 5],
    [7, 5],
  ]);
  expect(shared.nextState.tanks.map((tank) => tank.facing)).toStrictEqual(["right", "left"]);
  const swap = step(
    world([
      [[5, 5], "up"],
      [[6, 5], "up"],
    ]),
    { 0: move("right"), 1: move("left") },
  );
  expect(positions(swap.nextState)).toStrictEqual([
    [5, 5],
    [6, 5],
  ]);
});

test("a tank may enter the cell the other tank leaves this tick", () => {
  const output = step(
    world([
      [[5, 5], "up"],
      [[6, 5], "up"],
    ]),
    { 0: move("right"), 1: move("right") },
  );
  expect(positions(output.nextState)).toStrictEqual([
    [6, 5],
    [7, 5],
  ]);
  const blockedLeader = step(
    world(
      [
        [[5, 5], "up"],
        [[6, 5], "up"],
      ],
      { [5 * 21 + 7]: 2 },
    ),
    {
      0: move("right"),
      1: move("right"),
    },
  );
  expect(positions(blockedLeader.nextState)).toStrictEqual([
    [5, 5],
    [6, 5],
  ]);
});

test("fire spawns one bullet on the own cell that flies two cells and is immune to its owner", () => {
  const output = step(
    world([
      [[2, 7], "right"],
      [[18, 7], "left"],
    ]),
    { 0: fire() },
  );
  expect(output.nextState.bullets).toStrictEqual([
    { position: { x: 4, y: 7 }, direction: "right", owner: 0 },
  ]);
  expect(output.events).toStrictEqual([
    { type: "fire", playerId: "alpha", position: { x: 2, y: 7 }, direction: "right" },
  ]);
  const again = step(output.nextState, { 0: fire() });
  expect(again.nextState.bullets).toHaveLength(1);
  expect(again.nextState.bullets[0]!.position).toStrictEqual({ x: 6, y: 7 });
  expect(again.events).toStrictEqual([]);
  // The owner steps into its own bullet's path; the bullet passes through and flies on.
  const own = bullet(
    world([
      [[5, 7], "up"],
      [[18, 7], "left"],
    ]),
    0,
    [3, 7],
    "right",
  );
  const passed = step(own, { 0: idle() });
  expect(passed.nextState.bullets[0]!.position).toStrictEqual({ x: 5, y: 7 });
  expect(hps(passed.nextState)).toStrictEqual([3, 3]);
  expect(step(passed.nextState).nextState.bullets[0]!.position).toStrictEqual({ x: 7, y: 7 });
});

test("bullets vanish at the edge and on steel, and break the brick they enter", () => {
  const edge = step(
    bullet(
      world([
        [[5, 7], "up"],
        [[18, 7], "left"],
      ]),
      0,
      [19, 0],
      "right",
    ),
  );
  expect(edge.nextState.bullets).toStrictEqual([]);
  expect(edge.events).toStrictEqual([]);
  const steel = world(
    [
      [[5, 7], "up"],
      [[18, 7], "left"],
    ],
    { 8: 2 },
  );
  const stopped = step(bullet(steel, 0, [6, 0], "right"));
  expect(stopped.nextState.bullets).toStrictEqual([]);
  expect(stopped.nextState.cells[8]).toBe(2);
  // Two bricks in a row: the first sub-step breaks one, the next tick breaks the other.
  const bricks = world(
    [
      [[5, 7], "up"],
      [[18, 7], "left"],
    ],
    { 7: 1, 8: 1 },
  );
  const first = step(bullet(bricks, 0, [6, 0], "right"));
  expect(first.nextState.bullets).toStrictEqual([]);
  expect([first.nextState.cells[7], first.nextState.cells[8]]).toStrictEqual([0, 1]);
  expect(first.events).toStrictEqual([
    { type: "brick-destroyed", attackerId: "alpha", cells: [7] },
  ]);
});

test("a hit takes one hp with an event, and bullets passing in opposite directions cancel", () => {
  const hit = step(
    bullet(
      world([
        [[5, 7], "up"],
        [[9, 7], "left"],
      ]),
      0,
      [7, 7],
      "right",
    ),
  );
  expect(hps(hit.nextState)).toStrictEqual([3, 2]);
  expect(hit.nextState.bullets).toStrictEqual([]);
  expect(hit.events).toStrictEqual([
    { type: "hit", playerId: "beta", attackerId: "alpha", position: { x: 9, y: 7 }, hp: 2 },
  ]);
  // Same cell after the first sub-step.
  const meet = bullet(
    bullet(
      world([
        [[2, 7], "up"],
        [[18, 7], "up"],
      ]),
      0,
      [8, 7],
      "right",
    ),
    1,
    [10, 7],
    "left",
  );
  const met = step(meet);
  expect(met.nextState.bullets).toStrictEqual([]);
  expect(met.events).toStrictEqual([{ type: "bullets-cancelled", position: { x: 9, y: 7 } }]);
  // Adjacent and head-on: they swap cells in the first sub-step.
  const swap = bullet(
    bullet(
      world([
        [[2, 7], "up"],
        [[18, 7], "up"],
      ]),
      0,
      [8, 7],
      "right",
    ),
    1,
    [9, 7],
    "left",
  );
  const swapped = step(swap);
  expect(swapped.nextState.bullets).toStrictEqual([]);
  expect(swapped.events).toStrictEqual([{ type: "bullets-cancelled", position: { x: 9, y: 7 } }]);
  // Cancelling wins over every other effect: a brick both enter stays.
  const brick = world(
    [
      [[2, 7], "up"],
      [[18, 7], "up"],
    ],
    { [7 * 21 + 9]: 1 },
  );
  const kept = step(bullet(bullet(brick, 0, [8, 7], "right"), 1, [10, 7], "left"));
  expect(kept.nextState.cells[7 * 21 + 9]).toBe(1);
  expect(kept.events).toStrictEqual([{ type: "bullets-cancelled", position: { x: 9, y: 7 } }]);
});

test("point-blank fire hits in the same tick and a kill ends the match with the survivor first", () => {
  const state = world([
    [[5, 7], "right"],
    [[7, 7], "left"],
  ]);
  state.tanks[1]!.hp = 1;
  bullet(state, 1, [3, 3], "up");
  const output = step(state, { 0: fire() });
  expect(output.events).toStrictEqual([
    { type: "fire", playerId: "alpha", position: { x: 5, y: 7 }, direction: "right" },
    { type: "hit", playerId: "beta", attackerId: "alpha", position: { x: 7, y: 7 }, hp: 0 },
    { type: "death", playerId: "beta", position: { x: 7, y: 7 } },
  ]);
  expect(output.nextState.tanks[1]).toStrictEqual({
    id: "beta",
    slot: 1,
    position: null,
    facing: "left",
    hp: 0,
    death: { tick: 1 },
  });
  // The dead tank's own bullet vanishes with it.
  expect(output.nextState.bullets).toStrictEqual([]);
  expect(resultOf(output)).toMatchObject({ reason: "elimination", completedTicks: 1 });
  expect(ranks(output)).toStrictEqual([
    [1, 3, true],
    [2, 0, false],
  ]);
  expect(tankRules.observe(output.nextState, "alpha")).toBe(null);
  expect(() => tankRules.step(output.nextState, { alpha: idle(), beta: idle() })).toThrow(
    /finished/,
  );
});

test("both tanks destroyed in one tick share first place", () => {
  const state = world([
    [[5, 7], "right"],
    [[8, 7], "left"],
  ]);
  state.tanks[0]!.hp = 1;
  state.tanks[1]!.hp = 1;
  // Bullets already past each other, each one cell short of its target.
  bullet(state, 0, [7, 7], "right");
  bullet(state, 1, [6, 7], "left");
  const output = step(state);
  expect(eventsOf(output, "hit")).toHaveLength(2);
  expect(eventsOf(output, "death").map((event) => event.playerId)).toStrictEqual(["alpha", "beta"]);
  expect(resultOf(output).reason).toBe("elimination");
  expect(ranks(output)).toStrictEqual([
    [1, 0, false],
    [1, 0, false],
  ]);
});

test("at the tick limit the tank with more hp wins and equal hp ties", () => {
  const state = world([
    [[5, 7], "right"],
    [[15, 7], "left"],
  ]);
  state.tick = 599;
  state.tanks[1]!.hp = 2;
  const output = step(state);
  expect(resultOf(output)).toMatchObject({ reason: "tick-limit", completedTicks: 600 });
  expect(ranks(output)).toStrictEqual([
    [1, 3, true],
    [2, 2, true],
  ]);
  const even = world([
    [[5, 7], "right"],
    [[15, 7], "left"],
  ]);
  even.tick = 599;
  expect(ranks(step(even))).toStrictEqual([
    [1, 3, true],
    [1, 3, true],
  ]);
  expect(
    step(
      world([
        [[5, 7], "right"],
        [[15, 7], "left"],
      ]),
    ).result,
  ).toBeUndefined();
});

test("events of one tick are grouped by kind: moves, fires, hits, bricks, cancellations, deaths", () => {
  const state = world(
    [
      [[5, 7], "up"],
      [[9, 7], "left"],
    ],
    { [5 * 21 + 5]: 1 },
  );
  state.tanks[0]!.hp = 1;
  bullet(state, 1, [7, 7], "left");
  const output = step(state, { 0: fire(), 1: move("down") });
  expect(output.events).toStrictEqual([
    { type: "move", playerId: "beta", from: { x: 9, y: 7 }, to: { x: 9, y: 8 }, facing: "down" },
    { type: "fire", playerId: "alpha", position: { x: 5, y: 7 }, direction: "up" },
    { type: "hit", playerId: "alpha", attackerId: "beta", position: { x: 5, y: 7 }, hp: 0 },
    { type: "brick-destroyed", attackerId: "alpha", cells: [5 * 21 + 5] },
    { type: "death", playerId: "alpha", position: { x: 5, y: 7 } },
  ]);
  expect(output.nextState.bullets).toStrictEqual([]);
});

test("the default action is idle and unknown players are rejected", () => {
  const state = init();
  expect(tankRules.defaultAction(state, "beta")).toStrictEqual(idle());
  expect(() => tankRules.defaultAction(state, "nobody")).toThrow(/Unknown/);
  expect(() => tankRules.observe(state, "nobody")).toThrow(/Unknown/);
  const observation = required(tankRules.observe(state, "beta"));
  expect(observation.tanks.map((tank) => tank.bulletInFlight)).toStrictEqual([false, false]);
  expect(index(state, [1, 7])).toBe(148);
});
