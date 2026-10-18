import type { PaperStepResult } from "@si-arena/game-paper/rules";
import type { Slot } from "./helpers";
import { test, expect } from "vitest";
import { paperRules, parsePaperState } from "@si-arena/game-paper/rules";
import { actions, idle, indexAt, move, outside, stepFrozen, world } from "./helpers";
import { resultOf, eventOf } from "./helpers";

function assertEliminated(output: PaperStepResult, slots: Slot[]) {
  for (const slot of slots) {
    expect(output.nextState.players[slot].alive).toBe(false);
    expect(output.nextState.players[slot].position).toBe(null);
    expect(!output.nextState.territory.includes(slot)).toBeTruthy();
    expect(!output.nextState.trails.includes(slot)).toBeTruthy();
    expect(resultOf(output).players[slot].score).toBe(0);
  }
  expect(parsePaperState(output.nextState)).toStrictEqual(output.nextState);
}

for (const [direction, position] of [
  ["left", { x: 0, y: 5 }],
  ["up", { x: 5, y: 0 }],
  ["right", { x: 39, y: 5 }],
  ["down", { x: 5, y: 29 }],
] as const) {
  test(`moving ${direction} across the edge eliminates only that player`, () => {
    const state = world([position, { x: 20, y: 20 }]);
    const output = stepFrozen(state, actions(move(direction)));
    assertEliminated(output, [0]);
    expect(resultOf(output).reason).toBe("last-survivor");
    expect(resultOf(output).completedTicks).toBe(1);
    expect(resultOf(output).players[1].rank).toBe(1);
    expect(
      resultOf(output).players[1].score,
      "the attacker does not inherit eliminated territory",
    ).toBe(1);
    expect(output.events).toStrictEqual([
      { type: "elimination", playerId: "alpha", causes: ["boundary"] },
    ]);
  });
}

test("two targets in the same neutral cell eliminate both heads", () => {
  const output = stepFrozen(
    world([
      { x: 5, y: 5 },
      { x: 7, y: 5 },
    ]),
    actions(move("right"), move("left")),
  );
  assertEliminated(output, [0, 1]);
  expect(resultOf(output).reason).toBe("mutual-elimination");
  expect(resultOf(output).players.map((player) => player.rank)).toStrictEqual([1, 1]);
});

test("entering an idle head eliminates both, even on the idle player's own territory", () => {
  const output = stepFrozen(
    world([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]),
    actions(move("right")),
  );
  assertEliminated(output, [0, 1]);
  expect(output.events.every((event) => event.type === "elimination")).toBeTruthy();
});

test("two moving heads swapping cells are eliminated simultaneously", () => {
  const output = stepFrozen(
    world([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]),
    actions(move("right"), move("left")),
  );
  assertEliminated(output, [0, 1]);
  expect(
    output.events.every(
      (event) => event.type === "elimination" && event.causes.includes("head-swap"),
    ),
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

test("moving onto an old self trail is lethal", () => {
  const state = outside(world(), 0, [
    [4, 5],
    [5, 5],
  ]);
  const output = stepFrozen(state, actions(move("left")));
  assertEliminated(output, [0]);
  expect(eventOf(output, "elimination").causes).toStrictEqual(["self-trail"]);
});

test("cutting an old enemy trail eliminates its owner without gifting their territory", () => {
  const state = outside(world(), 1, [
    [6, 5],
    [7, 5],
    [8, 5],
    [9, 5],
    [10, 5],
  ]);
  const output = stepFrozen(state, actions(move("right"), move("down")));
  assertEliminated(output, [1]);
  expect(resultOf(output).players[0].score).toBe(1);
  expect(output.nextState.territory[indexAt(38, 28)]).toBe(-1);
  expect(output.events[0]).toStrictEqual({
    type: "trail-cut",
    playerId: "beta",
    attackerId: "alpha",
    position: { x: 6, y: 5 },
  });
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
  assertEliminated(output, [1]);
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
  assertEliminated(output, [0, 1]);
  expect(output.events.filter((event) => event.type === "trail-cut").length).toBe(2);
});

test("a head-swap does not suppress either simultaneous trail cut", () => {
  const state = world();
  outside(state, 0, [[5, 5]]);
  outside(state, 1, [[6, 5]]);
  const output = stepFrozen(state, actions(move("right"), move("left")));
  assertEliminated(output, [0, 1]);
  for (const event of output.events.filter((candidate) => candidate.type === "elimination")) {
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
  assertEliminated(output, [0]);
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
  assertEliminated(output, [1]);
  expect(eventOf(output, "trail-cut").position).toStrictEqual({ x: 6, y: 4 });
});

test("finished games cannot be stepped and no player receives another observation", () => {
  const output = stepFrozen(
    world([
      { x: 0, y: 5 },
      { x: 20, y: 20 },
    ]),
    actions(move("left")),
  );
  expect(() => paperRules.step(output.nextState, actions())).toThrow(/finished/);
  expect(paperRules.observe(output.nextState, "alpha")).toBe(null);
  expect(paperRules.observe(output.nextState, "beta")).toBe(null);
});

test("an out-of-bounds target cannot wrap its linear index into an enemy trail", () => {
  const state = world([
    { x: 0, y: 5 },
    { x: 39, y: 4 },
  ]);
  outside(state, 1, [[39, 4]]);
  const output = stepFrozen(state, actions(move("left")));
  assertEliminated(output, [0]);
  expect(output.nextState.players[1].alive).toBe(true);
  expect(output.nextState.trails[indexAt(39, 4)]).toBe(1);
  expect(!output.events.some((event) => event.type === "trail-cut")).toBeTruthy();
});
