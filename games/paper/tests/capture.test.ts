import { test, expect } from "vitest";
import { parsePaperState } from "@si-arena/game-paper/rules";
import { actions, areaOf, box, idle, indexAt, move, outside, stepFrozen, world } from "./helpers";
import { eventOf } from "./helpers";

test("a trail may close on a different home cell and capture the enclosed interior", () => {
  const state = box(world(), 0);
  const output = stepFrozen(state, actions(move("left")));
  const rectangle = [2, 3, 4].flatMap((y) => [2, 3, 4].map((x) => indexAt(x, y)));
  expect(
    output.nextState.territory.flatMap((owner, index) => (owner === 0 ? [index] : [])),
  ).toStrictEqual(rectangle);
  expect(!output.nextState.trails.includes(0)).toBeTruthy();
  expect(output.nextState.territory[indexAt(3, 3)]).toBe(0);
  const capture = eventOf(output, "capture");
  expect(capture.cells).toStrictEqual(rectangle.filter((index) => index % 30 !== 2));
  expect(parsePaperState(output.nextState)).toStrictEqual(output.nextState);
});

test("all border cells seed the exterior fill and a loop against the map edge still closes", () => {
  const output = stepFrozen(box(world(), 0, 0, 0, 2, 2), actions(move("left")));
  expect(output.nextState.territory.filter((owner) => owner === 0).length).toBe(9);
  expect(output.nextState.territory[indexAt(1, 1)]).toBe(0);
  expect(output.nextState.territory[indexAt(3, 1)]).toBe(-1);
  expect(output.nextState.territory[indexAt(1, 3)]).toBe(-1);
});

test("movement wholly inside home produces no capture and no trail", () => {
  const state = world();
  state.territory[indexAt(6, 5)] = 0;
  const output = stepFrozen(state, actions(move("right")));
  expect(!output.events.some((event) => event.type === "capture")).toBeTruthy();
  expect(!output.nextState.trails.includes(0)).toBeTruthy();
});

test("simultaneous nested closures convert enclosed land and only suspend doubly-claimed neutral", () => {
  const state = box(world(), 0, 2, 2, 8, 8);
  box(state, 1, 4, 4, 6, 6);
  state.territory[indexAt(5, 5)] = 0;
  const output = stepFrozen(state, actions(move("left"), move("left")));
  expect(output.nextState.territory[indexAt(3, 3)]).toBe(0);
  expect(
    output.nextState.territory[indexAt(5, 4)],
    "neutral trail cells enclosed by both closers stay neutral",
  ).toBe(-1);
  expect(
    output.nextState.territory[indexAt(4, 5)],
    "the outer closure converts the inner closer's home",
  ).toBe(0);
  expect(
    output.nextState.territory[indexAt(5, 5)],
    "the inner closure converts the enemy island it encloses",
  ).toBe(1);
  expect(
    output.nextState.trails.flatMap((owner, cell) => (owner === 1 ? [cell] : [])),
    "the inner closer stands on converted land and keeps one trail cell",
  ).toStrictEqual([indexAt(4, 6)]);
  expect(output.nextState.trails.includes(0)).toBe(false);
  expect(output.events.filter((event) => event.type === "capture").length).toBe(2);
  expect(output.nextState.territory.filter((owner) => owner === 0).length).toBe(43);
  expect(output.nextState.territory.filter((owner) => owner === 1).length).toBe(1);
});

test("enclosed enemy territory converts even when the enemy closes elsewhere on the same tick", () => {
  const state = box(world(), 0, 2, 2, 8, 8);
  box(state, 1, 20, 20, 22, 22);
  state.territory[indexAt(5, 5)] = 1;
  const output = stepFrozen(state, actions(move("left"), move("left")));
  expect(output.nextState.territory[indexAt(5, 5)], "enclosed enemy land converts").toBe(0);
  expect(output.events.filter((event) => event.type === "capture")).toHaveLength(2);
  expect(output.nextState.territory.filter((owner) => owner === 1).length).toBe(9);
});

test("two independent simultaneous closures both gain land", () => {
  const state = box(world(), 0);
  box(state, 1, 20, 20, 22, 22);
  const output = stepFrozen(state, actions(move("left"), move("left")));
  expect(output.nextState.territory.filter((owner) => owner === 0).length).toBe(9);
  expect(output.nextState.territory.filter((owner) => owner === 1).length).toBe(9);
  expect(output.events.filter((event) => event.type === "capture").length).toBe(2);
  expect(parsePaperState(output.nextState)).toStrictEqual(output.nextState);
});

test("capturing enemy territory neither kills their head nor deletes their existing trail", () => {
  const state = box(world(), 0);
  state.players[1].position = { x: 3, y: 3 };
  state.trails[indexAt(3, 3)] = 1;
  const output = stepFrozen(state, actions(move("left")));
  expect(output.nextState.players[1].alive).toBe(true);
  expect(output.nextState.territory[indexAt(3, 3)]).toBe(0);
  expect(output.nextState.trails[indexAt(3, 3)]).toBe(1);
  expect(output.nextState.territory[indexAt(24, 14)], "disconnected territory is retained").toBe(1);
});

test("covering a head's last home creates a vulnerable one-cell trail, and zero land keeps the player in the match", () => {
  const state = box(world(), 0);
  state.territory = state.territory.map((owner) => (owner === 1 ? -1 : owner));
  state.territory[indexAt(3, 3)] = 1;
  state.players[1].position = { x: 3, y: 3 };
  const captured = stepFrozen(state, actions(move("left")));
  expect(captured.result).toBe(undefined);
  expect(captured.nextState.players[1].alive).toBe(true);
  expect(!captured.nextState.territory.includes(1)).toBeTruthy();
  expect(captured.nextState.trails[indexAt(3, 3)]).toBe(1);
  let next = stepFrozen(captured.nextState, actions(move("down"), move("down")));
  next = stepFrozen(next.nextState, actions(move("down"), move("left")));
  next = stepFrozen(next.nextState, actions(move("down"), move("down")));
  expect(next.result, "a player without land never ends the match early").toBe(undefined);
  expect(next.nextState.players[1].alive).toBe(true);
  expect(!next.events.some((event) => event.type === "capture")).toBeTruthy();
});

test("a player without home cannot turn their trail into territory just by walking", () => {
  const state = box(world(), 0);
  state.territory = state.territory.map((owner) => (owner === 1 ? -1 : owner));
  state.territory[indexAt(3, 3)] = 1;
  state.players[1].position = { x: 3, y: 3 };
  let output = stepFrozen(state, actions(move("left")));
  for (const direction of ["down", "right", "up"] as const) {
    output = stepFrozen(output.nextState, actions(idle(), move(direction)));
    expect(output.result).toBe(undefined);
    expect(!output.nextState.territory.includes(1)).toBeTruthy();
    expect(!output.events.some((event) => event.type === "capture")).toBeTruthy();
  }
});

test("the fill uses four-neighbor reachability, so diagonal gaps do not expose an interior cell", () => {
  const state = outside(
    world(),
    0,
    [[3, 4]],
    [
      [3, 2],
      [2, 3],
      [4, 3],
      [2, 4],
    ],
  );
  const output = stepFrozen(state, actions(move("left")));
  expect(output.nextState.territory[indexAt(3, 3)]).toBe(0);
  expect(output.nextState.territory[indexAt(4, 2)]).toBe(-1);
  expect(output.nextState.territory[indexAt(4, 4)]).toBe(-1);
  expect(output.nextState.territory.filter((owner) => owner === 0).length).toBe(6);
});

test("a moving enemy head also receives a new trail if closure covers its destination", () => {
  const state = box(world(), 0, 2, 2, 6, 6);
  state.territory = state.territory.map((owner) => (owner === 1 ? -1 : owner));
  state.players[1].position = { x: 3, y: 3 };
  state.territory[indexAt(3, 3)] = 1;
  state.territory[indexAt(4, 3)] = 1;
  const output = stepFrozen(state, actions(move("left"), move("right")));
  expect(output.result).toBe(undefined);
  expect(output.nextState.players[1].position).toStrictEqual({ x: 4, y: 3 });
  expect(output.nextState.territory[indexAt(4, 3)]).toBe(0);
  expect(output.nextState.trails[indexAt(4, 3)]).toBe(1);
  expect(output.nextState.trails.filter((owner) => owner === 1).length).toBe(1);
});

test("a closer that cuts a tail on their home cell still captures the enclosed land", () => {
  const state = box(world(), 0);
  outside(state, 1, [
    [2, 4],
    [24, 14],
  ]);
  const output = stepFrozen(state, actions(move("left")));
  expect(output.nextState.players[1].alive).toBe(true);
  expect(output.nextState.players[1].position).toStrictEqual(output.nextState.spawns[1]);
  expect(
    output.nextState.trails.flatMap((owner, index) => (owner === 1 ? [index] : [])),
    "the old trail is cut and the spawn outside the own territory keeps one cell",
  ).toStrictEqual([indexAt(24, 14)]);
  expect(output.nextState.territory.includes(1), "the reset player keeps its home").toBeTruthy();
  expect(areaOf(output.nextState, 0)).toBe(9);
  expect(output.events.map((event) => event.type)).toStrictEqual([
    "trail-cut",
    "reset",
    "move",
    "capture",
  ]);
});
