import { expect } from "vitest";
import { snakeManifest } from "@si-arena/game-snake";
import type {
  SnakeAction,
  SnakeDirection,
  SnakePosition,
  SnakeState,
} from "@si-arena/game-snake/sdk";
import { parseSnakeState, snakeRules } from "@si-arena/game-snake/rules";
import type { SnakeEvent, SnakeResult, SnakeStepResult } from "@si-arena/game-snake/rules";

export type Cell = readonly [number, number];
export type TickActions = Record<string, SnakeAction>;
export const IDS = ["alpha", "beta", "gamma", "delta"] as const;
export const DIRECTIONS = ["up", "right", "down", "left"] as const;

/** Fail explicitly while narrowing optional values in strict test code. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected a value in the test fixture");
  return value;
}
export const move = (direction: SnakeDirection): SnakeAction => ({ type: "move", direction });
export const at = ([x, y]: Cell): SnakePosition => ({ x, y });

export function init(players = 2, seed = 2): SnakeState {
  return snakeRules.init({
    seed,
    config: { ...snakeManifest.config },
    players: IDS.slice(0, players).map((id, slot) => ({ id, slot })),
  });
}

const headingOf = (body: readonly Cell[]): SnakeDirection => {
  const [head, neck] = [required(body[0]), required(body[1])];
  if (head[0] === neck[0] && head[1] === neck[1]) return "right";
  if (head[0] > neck[0]) return "right";
  if (head[0] < neck[0]) return "left";
  return head[1] > neck[1] ? "down" : "up";
};

/**
 * A world with the given bodies (head first) and food, no history. Headings follow the
 * first two segments; a stacked spawn body faces right.
 */
export function world(
  bodies: readonly (readonly Cell[])[],
  food: readonly Cell[] = [],
  health = 100,
): SnakeState {
  const state = init(bodies.length);
  bodies.forEach((body, slot) => {
    const snake = state.snakes[slot]!;
    snake.body = body.map(at);
    snake.heading = headingOf(body);
    snake.health = health;
  });
  state.food = food.map(at).toSorted((a, b) => index(state, a) - index(state, b));
  return state;
}

/** Mark a snake as eliminated earlier. */
export function eliminate(state: SnakeState, slot: number, tick = 1): SnakeState {
  const snake = state.snakes[slot]!;
  snake.body = [];
  snake.health = 0;
  snake.death = { tick, causes: ["boundary"] };
  state.tick = Math.max(state.tick, tick);
  return state;
}

/** Actions for every living snake: straight ahead unless given by slot. */
export function actions(state: SnakeState, bySlot: Record<number, SnakeAction> = {}) {
  return Object.fromEntries(
    state.snakes.flatMap((snake) =>
      snake.death ? [] : [[snake.id, bySlot[snake.slot] ?? move(snake.heading)]],
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
export function stepFrozen(state: SnakeState, input: TickActions): SnakeStepResult {
  const before = JSON.stringify(state);
  const beforeActions = JSON.stringify(input);
  const output = snakeRules.step(deepFreeze(structuredClone(state)), deepFreeze(input));
  expect(JSON.stringify(state)).toBe(before);
  expect(JSON.stringify(input)).toBe(beforeActions);
  expect(parseSnakeState(output.nextState)).toStrictEqual(output.nextState);
  return output;
}

export function step(state: SnakeState, bySlot: Record<number, SnakeAction> = {}) {
  return stepFrozen(state, actions(state, bySlot));
}

export const index = (state: { width: number }, cell: SnakePosition) =>
  cell.y * state.width + cell.x;
export const bodyOf = (state: SnakeState, slot: number): Cell[] =>
  state.snakes[slot]!.body.map((cell) => [cell.x, cell.y]);
export const foodOf = (state: SnakeState): Cell[] => state.food.map((cell) => [cell.x, cell.y]);
export const deaths = (output: SnakeStepResult) =>
  output.events.flatMap((event) =>
    event.type === "death" ? [[event.playerId, event.causes] as const] : [],
  );
export function eventsOf<Type extends SnakeEvent["type"]>(
  output: SnakeStepResult,
  type: Type,
): Extract<SnakeEvent, { type: Type }>[] {
  return output.events.filter(
    (event): event is Extract<SnakeEvent, { type: Type }> => event.type === type,
  );
}
export function resultOf(output: { result?: SnakeResult | undefined }) {
  return required(output.result);
}
export const ranks = (output: { result?: SnakeResult | undefined }) =>
  resultOf(output).players.map((player) => [player.rank, player.score, player.alive]);

/**
 * Deterministic pseudo-random actions for long generated games: a seeded pick among the
 * directions that stay on the map and do not reverse, so games last long enough to eat and
 * spawn food before the snakes run into each other.
 */
export function randomActions(seed: number) {
  let random = seed;
  return (state: SnakeState) => {
    const bySlot: Record<number, SnakeAction> = {};
    for (const snake of state.snakes) {
      if (snake.death) continue;
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const head = snake.body[0]!;
      const open = DIRECTIONS.filter((direction) => {
        const x = head.x + (direction === "right" ? 1 : direction === "left" ? -1 : 0);
        const y = head.y + (direction === "down" ? 1 : direction === "up" ? -1 : 0);
        const reverse = DIRECTIONS[(DIRECTIONS.indexOf(snake.heading) + 2) % 4];
        return x >= 0 && y >= 0 && x < state.width && y < state.height && direction !== reverse;
      });
      // Half the time head for the nearest food, so games eat and spawn; otherwise turn at
      // random or keep straight on, so bodies stretch across the board.
      const nearest = state.food.toSorted(
        (a, b) =>
          Math.abs(a.x - head.x) +
          Math.abs(a.y - head.y) -
          Math.abs(b.x - head.x) -
          Math.abs(b.y - head.y),
      )[0];
      const toward =
        nearest &&
        open.find((direction) =>
          direction === "right"
            ? nearest.x > head.x
            : direction === "left"
              ? nearest.x < head.x
              : direction === "down"
                ? nearest.y > head.y
                : nearest.y < head.y,
        );
      const kind = random % 4;
      const pick =
        kind === 0
          ? open[(random >>> 8) % open.length]
          : kind === 1 || kind === 2
            ? toward
            : snake.heading;
      bySlot[snake.slot] = move(pick && open.includes(pick) ? pick : (open[0] ?? snake.heading));
    }
    return actions(state, bySlot);
  };
}
