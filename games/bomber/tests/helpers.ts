import { expect } from "vitest";
import { bomberManifest, collapsedRings, ringOf } from "@si-arena/game-bomber";
import type {
  BomberAction,
  BomberDirection,
  BomberPowerupKind,
  BomberState,
} from "@si-arena/game-bomber/sdk";
import { parseBomberState, bomberRules } from "@si-arena/game-bomber/rules";
import type { BomberEvent, BomberResult, BomberStepResult } from "@si-arena/game-bomber/rules";

export type Cell = readonly [number, number];
export type TickActions = Record<string, BomberAction>;
export const IDS = ["alpha", "beta", "gamma", "delta"] as const;

/** Fail explicitly while narrowing optional values in strict test code. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected a value in the test fixture");
  return value;
}
export const idle = (): BomberAction => ({ type: "idle" });
export const bomb = (): BomberAction => ({ type: "bomb" });
export const move = (direction: BomberDirection): BomberAction => ({ type: "move", direction });

export function init(players = 2, seed = 2): BomberState {
  return bomberRules.init({
    seed,
    config: { ...bomberManifest.config },
    players: IDS.slice(0, players).map((id, slot) => ({ id, slot })),
  });
}

export const index = (state: BomberState, [x, y]: Cell) => y * state.width + x;

/** Open arena: no soft walls or items, pillars only, players standing on the given cells. */
export function world(positions: readonly Cell[]): BomberState {
  const state = init(positions.length);
  state.cells = state.cells.map((cell) => (cell === 2 ? 0 : cell));
  state.hidden.fill(0);
  positions.forEach(([x, y], slot) => {
    state.players[slot]!.position = { x, y };
  });
  return state;
}

export function wall(state: BomberState, cell: Cell, hidden = 0): BomberState {
  state.cells[index(state, cell)] = 2;
  state.hidden[index(state, cell)] = hidden;
  return state;
}

export function powerup(state: BomberState, cell: Cell, kind: BomberPowerupKind): BomberState {
  state.powerups.push({ position: { x: cell[0], y: cell[1] }, kind });
  return state;
}

/** A bomb that explodes after `fuse` more settlements (1 = the next one). */
export function placeBomb(state: BomberState, slot: number, cell: Cell, fuse = 1, range = 2) {
  state.bombs.push({ position: { x: cell[0], y: cell[1] }, owner: slot, fuse, range });
  return state;
}

/** Mark a player as eliminated earlier. */
export function eliminate(state: BomberState, slot: number, tick = 1): BomberState {
  const player = state.players[slot]!;
  player.position = null;
  player.death = { tick, causes: ["flame"] };
  player.score = 0;
  state.tick = Math.max(state.tick, tick);
  return state;
}

/** Actions for every living player: idle unless given by slot. */
export function actions(state: BomberState, bySlot: Record<number, BomberAction> = {}) {
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
export function stepFrozen(state: BomberState, input: TickActions): BomberStepResult {
  const before = JSON.stringify(state);
  const beforeActions = JSON.stringify(input);
  const output = bomberRules.step(deepFreeze(structuredClone(state)), deepFreeze(input));
  expect(JSON.stringify(state)).toBe(before);
  expect(JSON.stringify(input)).toBe(beforeActions);
  expect(parseBomberState(output.nextState)).toStrictEqual(output.nextState);
  return output;
}

export function step(state: BomberState, bySlot: Record<number, BomberAction> = {}) {
  return stepFrozen(state, actions(state, bySlot));
}

export const deaths = (output: BomberStepResult) =>
  output.events.flatMap((event) =>
    event.type === "death" ? [[event.playerId, event.causes] as const] : [],
  );
export function eventsOf<Type extends BomberEvent["type"]>(
  output: BomberStepResult,
  type: Type,
): Extract<BomberEvent, { type: Type }>[] {
  return output.events.filter(
    (event): event is Extract<BomberEvent, { type: Type }> => event.type === type,
  );
}
export function resultOf(output: { result?: BomberResult | undefined }) {
  return required(output.result);
}
export const ranks = (output: { result?: BomberResult | undefined }) =>
  resultOf(output).players.map((player) => [player.rank, player.score, player.alive]);
export const scores = (state: BomberState) => state.players.map((player) => player.score);

/** Deterministic pseudo-random actions for long generated games. */
export function randomActions(seed: number) {
  let random = seed;
  const directions = ["up", "right", "down", "left"] as const;
  return (state: BomberState) => {
    const bySlot: Record<number, BomberAction> = {};
    for (const player of state.players) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const roll = random % 8;
      bySlot[player.slot] =
        roll === 7
          ? idle()
          : roll === 6
            ? { type: "bomb" }
            : move(required(directions[(random >>> 8) % 4]));
    }
    return actions(state, bySlot);
  };
}

/** Advance the clock: rings the tick has removed become collapsed, with everything on them. */
export function collapseTo(state: BomberState, tick: number): BomberState {
  state.tick = tick;
  const rings = collapsedRings(tick);
  const fallen = (cell: number) =>
    ringOf(cell % state.width, Math.floor(cell / state.width)) < rings;
  state.cells = state.cells.map((value, cell) => (fallen(cell) ? 3 : value));
  state.hidden = state.hidden.map((value, cell) => (fallen(cell) ? 0 : value));
  state.bombs = state.bombs.filter((b) => !fallen(index(state, [b.position.x, b.position.y])));
  state.powerups = state.powerups.filter(
    (item) => !fallen(index(state, [item.position.x, item.position.y])),
  );
  return state;
}
