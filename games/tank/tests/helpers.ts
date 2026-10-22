import { expect } from "vitest";
import { tankManifest } from "@si-arena/game-tank";
import type { TankAction, TankDirection, TankPosition, TankState } from "@si-arena/game-tank/sdk";
import { parseTankState, tankRules } from "@si-arena/game-tank/rules";
import type { TankEvent, TankResult, TankStepResult } from "@si-arena/game-tank/rules";

export type Cell = readonly [number, number];
export type TickActions = Record<string, TankAction>;
export const IDS = ["alpha", "beta"] as const;

/** Fail explicitly while narrowing optional values in strict test code. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected a value in the test fixture");
  return value;
}
export const idle = (): TankAction => ({ type: "idle" });
export const fire = (): TankAction => ({ type: "fire" });
export const move = (direction: TankDirection): TankAction => ({ type: "move", direction });

export function init(seed = 2): TankState {
  return tankRules.init({
    seed,
    config: { ...tankManifest.config },
    players: IDS.map((id, slot) => ({ id, slot })),
  });
}

/**
 * Empty map with the tanks placed and facing as given; bullets and walls are added by
 * mutating the returned state.
 */
export function world(
  tanks: readonly [Cell, TankDirection][],
  walls: Record<number, 1 | 2> = {},
): TankState {
  const state = init();
  state.cells.fill(0);
  for (const [index, kind] of Object.entries(walls)) state.cells[Number(index)] = kind;
  tanks.forEach(([[x, y], facing], slot) => {
    const tank = state.tanks[slot]!;
    tank.position = { x, y };
    tank.facing = facing;
  });
  return state;
}

export function bullet(state: TankState, owner: number, [x, y]: Cell, direction: TankDirection) {
  state.bullets.push({ position: { x, y }, direction, owner });
  return state;
}

/** Actions for both tanks: idle unless given by slot. */
export function actions(state: TankState, bySlot: Record<number, TankAction> = {}) {
  return Object.fromEntries(
    state.tanks.map((tank) => [tank.id, bySlot[tank.slot] ?? idle()]),
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
export function stepFrozen(state: TankState, input: TickActions): TankStepResult {
  const before = JSON.stringify(state);
  const beforeActions = JSON.stringify(input);
  const output = tankRules.step(deepFreeze(structuredClone(state)), deepFreeze(input));
  expect(JSON.stringify(state)).toBe(before);
  expect(JSON.stringify(input)).toBe(beforeActions);
  expect(parseTankState(output.nextState)).toStrictEqual(output.nextState);
  return output;
}

export function step(state: TankState, bySlot: Record<number, TankAction> = {}) {
  return stepFrozen(state, actions(state, bySlot));
}

export const index = (state: TankState, [x, y]: Cell) => y * state.width + x;
export const at = (position: TankPosition | null): Cell | null =>
  position ? [position.x, position.y] : null;
export const positions = (state: TankState) => state.tanks.map((tank) => at(tank.position));
export const hps = (state: TankState) => state.tanks.map((tank) => tank.hp);
export function eventsOf<Type extends TankEvent["type"]>(
  output: TankStepResult,
  type: Type,
): Extract<TankEvent, { type: Type }>[] {
  return output.events.filter(
    (event): event is Extract<TankEvent, { type: Type }> => event.type === type,
  );
}
export function resultOf(output: { result?: TankResult | undefined }) {
  return required(output.result);
}
export const ranks = (output: { result?: TankResult | undefined }) =>
  resultOf(output).players.map((player) => [player.rank, player.score, player.alive]);

/** Deterministic pseudo-random actions for long generated games. */
export function randomActions(seed: number) {
  let random = seed;
  const directions = ["up", "right", "down", "left"] as const;
  return (state: TankState) => {
    const bySlot: Record<number, TankAction> = {};
    for (const tank of state.tanks) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const roll = random % 8;
      bySlot[tank.slot] =
        roll === 7 ? idle() : roll >= 5 ? fire() : move(required(directions[(random >>> 8) % 4]));
    }
    return actions(state, bySlot);
  };
}
