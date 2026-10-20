import { test, expect } from "vitest";
import { paperRules } from "@si-arena/game-paper/rules";
import { actions, assertReset, idle, indexAt, move, outside, stepFrozen, world } from "./helpers";
import { areaOf, eventOf } from "./helpers";

for (const [direction, position] of [
  ["left", { x: 0, y: 5 }],
  ["up", { x: 5, y: 0 }],
  ["right", { x: 29, y: 5 }],
  ["down", { x: 5, y: 29 }],
] as const) {
  test(`moving ${direction} across the edge resets that player to its spawn`, () => {
    const state = world([position, { x: 20, y: 20 }]);
    const output = stepFrozen(state, actions(move(direction)));
    assertReset(output, [0]);
    expect(output.nextState.players[1].position).toStrictEqual({ x: 20, y: 20 });
    expect(output.result, "a reset never ends the match").toBe(undefined);
    expect(output.events).toStrictEqual([
      {
        type: "reset",
        playerId: "alpha",
        from: position,
        to: output.nextState.spawns[0],
        causes: ["boundary"],
      },
    ]);
  });
}

test("a reset keeps the territory of the reset player", () => {
  const state = world([
    { x: 0, y: 5 },
    { x: 20, y: 20 },
  ]);
  state.territory[indexAt(7, 7)] = 0;
  state.territory[indexAt(8, 8)] = 0;
  const output = stepFrozen(state, actions(move("left")));
  expect(areaOf(output.nextState, 0)).toBe(3);
  expect(areaOf(output.nextState, 1)).toBe(1);
});

test("two targets in the same neutral cell reset both heads", () => {
  const output = stepFrozen(
    world([
      { x: 5, y: 5 },
      { x: 7, y: 5 },
    ]),
    actions(move("right"), move("left")),
  );
  assertReset(output, [0, 1]);
  expect(output.result).toBe(undefined);
  expect(
    output.events.every(
      (event) => event.type === "reset" && event.causes.includes("head-collision"),
    ),
  ).toBeTruthy();
});

test("entering an idle head resets both, even on the idle player's own territory", () => {
  const output = stepFrozen(
    world([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]),
    actions(move("right")),
  );
  assertReset(output, [0, 1]);
  expect(output.events.every((event) => event.type === "reset")).toBeTruthy();
});

test("two moving heads swapping cells are reset simultaneously", () => {
  const output = stepFrozen(
    world([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]),
    actions(move("right"), move("left")),
  );
  assertReset(output, [0, 1]);
  expect(
    output.events.every((event) => event.type === "reset" && event.causes.includes("head-swap")),
  ).toBeTruthy();
});

test("a departing head can be followed into its old cell when that cell has no old trail", () => {
  const output = stepFrozen(
    world([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]),
    actions(move("right"), move("up")),
  );
  expect(output.result).toBe(undefined);
  expect(output.nextState.players.map((player) => player.position)).toStrictEqual([
    { x: 6, y: 5 },
    { x: 6, y: 4 },
  ]);
  expect(output.nextState.trails[indexAt(6, 5)]).toBe(0);
  expect(output.nextState.trails[indexAt(6, 4)]).toBe(1);
});

test("moving onto an old self trail resets the player", () => {
  const state = outside(world(), 0, [
    [4, 5],
    [5, 5],
  ]);
  const output = stepFrozen(state, actions(move("left")));
  assertReset(output, [0]);
  expect(eventOf(output, "reset").causes).toStrictEqual(["self-trail"]);
});

test("cutting an old enemy trail resets its owner and keeps the territory of the victim", () => {
  const state = outside(world(), 1, [
    [6, 5],
    [7, 5],
    [8, 5],
    [9, 5],
    [10, 5],
  ]);
  const output = stepFrozen(state, actions(move("right"), move("down")));
  assertReset(output, [1]);
  expect(areaOf(output.nextState, 1), "a reset does not take the territory away").toBe(1);
  expect(areaOf(output.nextState, 0)).toBe(1);
  expect(output.nextState.players[0].alive).toBe(true);
  expect(output.nextState.players[0].position).toStrictEqual({ x: 6, y: 5 });
  expect(output.events[0]).toStrictEqual({
    type: "trail-cut",
    playerId: "beta",
    attackerId: "alpha",
    position: { x: 6, y: 5 },
  });
  expect(eventOf(output, "reset").causes).toStrictEqual(["trail-cut"]);
});

test("a vacated head cell is still attackable when it already contained the owner's trail", () => {
  const state = outside(
    world([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]),
    1,
    [[6, 5]],
  );
  const output = stepFrozen(state, actions(move("right"), move("up")));
  assertReset(output, [1]);
  expect(output.nextState.players[0].alive).toBe(true);
});

test("mutual trail cuts are calculated before either old trail is erased", () => {
  const state = world();
  outside(state, 0, [
    [7, 5],
    [5, 5],
  ]);
  outside(state, 1, [
    [6, 5],
    [8, 5],
  ]);
  const output = stepFrozen(state, actions(move("right"), move("left")));
  assertReset(output, [0, 1]);
  expect(output.events.filter((event) => event.type === "trail-cut").length).toBe(2);
});

test("a head-swap does not suppress either simultaneous trail cut", () => {
  const state = world();
  outside(state, 0, [[5, 5]]);
  outside(state, 1, [[6, 5]]);
  const output = stepFrozen(state, actions(move("right"), move("left")));
  assertReset(output, [0, 1]);
  for (const event of output.events.filter((candidate) => candidate.type === "reset")) {
    expect(event.causes).toStrictEqual(["head-swap", "trail-cut"]);
  }
});

test("being cut on the return-home tick prevents closure and capture", () => {
  const state = world([
    { x: 5, y: 5 },
    { x: 7, y: 5 },
  ]);
  outside(state, 0, [[6, 5]], [[5, 5]]);
  const output = stepFrozen(state, actions(move("left"), move("left")));
  assertReset(output, [0]);
  expect(!output.events.some((event) => event.type === "capture")).toBeTruthy();
  expect(output.nextState.players[1].position).toStrictEqual({ x: 6, y: 5 });
});

test("new trail cells become attackable on later ticks", () => {
  let state = world([
    { x: 5, y: 5 },
    { x: 6, y: 5 },
  ]);
  state = stepFrozen(state, actions(idle(), move("up"))).nextState;
  state = stepFrozen(state, actions(move("up"), move("up"))).nextState;
  const output = stepFrozen(state, actions(move("right")));
  assertReset(output, [1]);
  expect(eventOf(output, "trail-cut").position).toStrictEqual({ x: 6, y: 4 });
});

test("a reset spawn that the opponent reaches in the same tick resets both heads", () => {
  const state = world([
    { x: 0, y: 5 },
    { x: 6, y: 14 },
  ]);
  const output = stepFrozen(state, actions(move("left"), move("left")));
  assertReset(output, [0, 1]);
  for (const event of output.events.filter((candidate) => candidate.type === "reset")) {
    expect(event.causes).toContain("head-collision");
  }
  expect(
    output.nextState.players[0].position,
    "the reset player keeps its own spawn",
  ).toStrictEqual(output.nextState.spawns[0]);
  expect(output.nextState.players[1].position).toStrictEqual(output.nextState.spawns[1]);
});

test("a reset returns the head to the spawn of its own slot", () => {
  const state = world([
    { x: 5, y: 5 },
    { x: 6, y: 5 },
  ]);
  const output = stepFrozen(state, actions(move("right"), move("left")));
  expect(output.nextState.players[0].position).toStrictEqual(output.nextState.spawns[0]);
  expect(output.nextState.players[1].position).toStrictEqual(output.nextState.spawns[1]);
  expect(output.nextState.players[0].position).not.toStrictEqual(
    output.nextState.players[1].position,
  );
});

test("the match only ends at the tick limit, never on a reset", () => {
  const output = stepFrozen(
    world([
      { x: 0, y: 5 },
      { x: 20, y: 20 },
    ]),
    actions(move("left")),
  );
  expect(output.result).toBe(undefined);
  expect(paperRules.observe(output.nextState, "alpha")).not.toBe(null);
  expect(paperRules.observe(output.nextState, "beta")).not.toBe(null);
});

test("an out-of-bounds target cannot wrap its linear index into an enemy trail", () => {
  const state = world([
    { x: 0, y: 5 },
    { x: 29, y: 4 },
  ]);
  outside(state, 1, [[29, 4]]);
  const output = stepFrozen(state, actions(move("left")));
  assertReset(output, [0]);
  expect(output.nextState.players[1].alive).toBe(true);
  expect(output.nextState.trails[indexAt(29, 4)]).toBe(1);
  expect(!output.events.some((event) => event.type === "trail-cut")).toBeTruthy();
});
