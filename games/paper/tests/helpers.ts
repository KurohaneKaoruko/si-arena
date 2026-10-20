import { expect } from "vitest";
import type { InitInput } from "@si-arena/protocol";
import { paperManifest } from "@si-arena/game-paper";
import type { PaperAction, PaperDirection, PaperState } from "@si-arena/game-paper/sdk";
import { paperRules, parsePaperState } from "@si-arena/game-paper/rules";
import type { PaperEvent, PaperResult, PaperStepResult } from "@si-arena/game-paper/rules";

export type Slot = 0 | 1;
export type Position = { x: number; y: number };
type Cell = readonly [number, number];
export type TickActions = Record<string, PaperAction>;

/** Fail explicitly while narrowing optional values in strict test code. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected a value in the test fixture");
  return value;
}
export function resultOf(output: { result?: PaperResult | undefined }) {
  const result = required(output.result);
  expect(result.players).toHaveLength(2);
  return {
    ...result,
    players: [required(result.players[0]), required(result.players[1])] as const,
  };
}
export function eventOf<Type extends PaperEvent["type"]>(
  output: PaperStepResult,
  type: Type,
): Extract<PaperEvent, { type: Type }> {
  return required(
    output.events.find(
      (event): event is Extract<PaperEvent, { type: Type }> => event.type === type,
    ),
  );
}
export const idle = (): PaperAction => ({ type: "idle" });
export const move = (direction: PaperDirection): PaperAction => ({ type: "move", direction });
export const indexAt = (x: number, y: number) => y * 40 + x;
/** Territory cells a slot owns in the given world. */
export const areaOf = (state: PaperState, slot: Slot) =>
  state.territory.filter((owner) => owner === slot).length;
export const validInit = (): InitInput => ({
  seed: 2,
  config: { ...paperManifest.config },
  players: [
    { id: "alpha", slot: 0 },
    { id: "beta", slot: 1 },
  ],
});
export const init = (seed = 2) => paperRules.init({ ...validInit(), seed });
export const actions = (first = idle(), second = idle()): TickActions => ({
  alpha: first,
  beta: second,
});

// Malformed inputs deliberately cross the type boundary to verify runtime validation.
export const initUnknown = (input: unknown) => paperRules.init(input as InitInput);
export const stepUnknown = (state: PaperState, input: unknown) =>
  paperRules.step(state, input as TickActions);

export function world(
  positions: readonly [Position, Position] = [
    { x: 5, y: 5 },
    { x: 34, y: 14 },
  ],
): PaperState {
  const state = init();
  state.territory.fill(-1);
  state.trails.fill(-1);
  for (const slot of [0, 1] as const) {
    state.players[slot].position = { ...positions[slot] };
    state.territory[indexAt(positions[slot].x, positions[slot].y)] = slot;
  }
  return state;
}
export function outside(
  state: PaperState,
  slot: Slot,
  points: readonly Cell[],
  home: readonly Cell[] = slot === 0 ? [[1, 1]] : [[38, 28]],
): PaperState {
  state.territory = state.territory.map((owner) => (owner === slot ? -1 : owner));
  state.trails = state.trails.map((owner) => (owner === slot ? -1 : owner));
  for (const [x, y] of home) state.territory[indexAt(x, y)] = slot;
  for (const [x, y] of points) state.trails[indexAt(x, y)] = slot;
  const [x, y] = required(points.at(-1));
  state.players[slot].position = { x, y };
  return state;
}
/** A left-side home and a three-sided trail, one move left from closing. */
export function box(
  state: PaperState,
  slot: Slot,
  left = 2,
  top = 2,
  right = 4,
  bottom = 4,
): PaperState {
  const points: Cell[] = [];
  const home: Cell[] = [];
  for (let y = top; y <= bottom; y++) home.push([left, y]);
  for (let x = left + 1; x <= right; x++) points.push([x, top]);
  for (let y = top + 1; y <= bottom; y++) points.push([right, y]);
  for (let x = right - 1; x > left; x--) points.push([x, bottom]);
  return outside(state, slot, points, home);
}
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export function stepFrozen(state: PaperState, input: TickActions): PaperStepResult {
  const before = JSON.stringify(state);
  const beforeActions = JSON.stringify(input);
  const output = paperRules.step(deepFreeze(state), deepFreeze(input));
  expect(JSON.stringify(state)).toBe(before);
  expect(JSON.stringify(input)).toBe(beforeActions);
  return output;
}

/**
 * A reset player stays in the match on its spawn cell with an empty trail.
 * A spawn outside the own territory leaves the one-cell trail the rules require,
 * so the player can be cut again right away.
 */
export function assertReset(output: PaperStepResult, slots: readonly Slot[]) {
  for (const slot of slots) {
    const spawn = output.nextState.spawns[slot];
    const index = indexAt(spawn.x, spawn.y);
    expect(output.nextState.players[slot].alive, "a reset never ends the match").toBe(true);
    expect(output.nextState.players[slot].position).toStrictEqual(spawn);
    const trail = output.nextState.trails.flatMap((owner, cell) => (owner === slot ? [cell] : []));
    if (output.nextState.territory[index] === slot) expect(trail).toStrictEqual([]);
    else expect(trail).toStrictEqual([index]);
  }
  expect(parsePaperState(output.nextState)).toStrictEqual(output.nextState);
}
export function play(initial: PaperState, ticks: readonly TickActions[]) {
  let state = structuredClone(initial);
  const events: PaperEvent[][] = [];
  let result: PaperResult | undefined;
  for (const tick of ticks) {
    expect(result, "no actions are permitted after the first terminal result").toBeUndefined();
    const output = stepFrozen(state, tick);
    state = output.nextState;
    events.push(output.events);
    result = output.result;
  }
  return { state, events, result };
}
