import { expect } from "vitest";
import { royaleManifest } from "@si-arena/game-royale";
import type { RoyaleAction, RoyaleDirection, RoyaleState } from "@si-arena/game-royale/sdk";
import { parseRoyaleState, royaleRules } from "@si-arena/game-royale/rules";
import type { RoyaleEvent, RoyaleResult, RoyaleStepResult } from "@si-arena/game-royale/rules";

export type Cell = readonly [number, number];
export type TickActions = Record<string, RoyaleAction>;
export const IDS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;

/** Fail explicitly while narrowing optional values in strict test code. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected a value in the test fixture");
  return value;
}
export const idle = (): RoyaleAction => ({ type: "idle" });
export const move = (direction: RoyaleDirection): RoyaleAction => ({ type: "move", direction });

export function init(players = 2, seed = 2): RoyaleState {
  return royaleRules.init({
    seed,
    config: { ...royaleManifest.config },
    players: IDS.slice(0, players).map((id, slot) => ({ id, slot })),
  });
}

/** Empty board: each head stands on a one-cell territory of its own, the zone is the map. */
export function world(heads: readonly Cell[]): RoyaleState {
  const state = init(heads.length);
  state.territory.fill(-1);
  state.trails.fill(-1);
  heads.forEach(([x, y], slot) => {
    state.players[slot]!.position = { x, y };
    state.territory[y * state.width + x] = slot;
  });
  return state;
}

/** Replace one player's land with `home` and its trail with `trail`; the head ends the trail. */
export function excursion(
  state: RoyaleState,
  slot: number,
  trail: readonly Cell[],
  home: readonly Cell[],
): RoyaleState {
  state.territory = state.territory.map((owner) => (owner === slot ? -1 : owner));
  state.trails = state.trails.map((owner) => (owner === slot ? -1 : owner));
  for (const [x, y] of home) state.territory[y * state.width + x] = slot;
  for (const [x, y] of trail) state.trails[y * state.width + x] = slot;
  const [x, y] = required(trail.at(-1));
  state.players[slot]!.position = { x, y };
  return state;
}

/** Mark a player as eliminated earlier, without land or head. */
export function eliminate(state: RoyaleState, slot: number, tick = 1): RoyaleState {
  const player = state.players[slot]!;
  state.territory = state.territory.map((owner) => (owner === slot ? -1 : owner));
  state.trails = state.trails.map((owner) => (owner === slot ? -1 : owner));
  player.position = null;
  player.death = { tick, causes: ["boundary"] };
  state.tick = Math.max(state.tick, tick);
  return state;
}

/** Actions for every living player: idle unless given by slot. */
export function actions(state: RoyaleState, bySlot: Record<number, RoyaleAction> = {}) {
  return Object.fromEntries(
    state.players.flatMap((player) =>
      player.position ? [[player.id, bySlot[player.slot] ?? idle()]] : [],
    ),
  ) as TickActions;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Step without touching the inputs and check the next world is a valid state. */
export function stepFrozen(state: RoyaleState, input: TickActions): RoyaleStepResult {
  const before = JSON.stringify(state);
  const beforeActions = JSON.stringify(input);
  const output = royaleRules.step(deepFreeze(structuredClone(state)), deepFreeze(input));
  expect(JSON.stringify(state)).toBe(before);
  expect(JSON.stringify(input)).toBe(beforeActions);
  expect(parseRoyaleState(output.nextState)).toStrictEqual(output.nextState);
  return output;
}

export function step(state: RoyaleState, bySlot: Record<number, RoyaleAction> = {}) {
  return stepFrozen(state, actions(state, bySlot));
}

export const index = (state: RoyaleState, [x, y]: Cell) => y * state.width + x;
export const areaOf = (state: RoyaleState, slot: number) =>
  state.territory.filter((owner) => owner === slot).length;
export const trailOf = (state: RoyaleState, slot: number) =>
  state.trails.flatMap((owner, cell) => (owner === slot ? [cell] : []));
export const deaths = (output: RoyaleStepResult) =>
  output.events.flatMap((event) =>
    event.type === "death" ? [[event.playerId, event.causes] as const] : [],
  );
export function eventsOf<Type extends RoyaleEvent["type"]>(
  output: RoyaleStepResult,
  type: Type,
): Extract<RoyaleEvent, { type: Type }>[] {
  return output.events.filter(
    (event): event is Extract<RoyaleEvent, { type: Type }> => event.type === type,
  );
}
export function resultOf(output: { result?: RoyaleResult | undefined }) {
  return required(output.result);
}
export const ranks = (output: { result?: RoyaleResult | undefined }) =>
  resultOf(output).players.map((player) => [player.rank, player.score, player.alive]);

/** Deterministic pseudo-random actions for long generated games. */
export function randomActions(seed: number) {
  let random = seed;
  const directions = ["up", "right", "down", "left"] as const;
  return (state: RoyaleState) => {
    const bySlot: Record<number, RoyaleAction> = {};
    for (const player of state.players) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      bySlot[player.slot] =
        random % 5 === 4 ? idle() : move(required(directions[(random >>> 8) % 4]));
    }
    return actions(state, bySlot);
  };
}
