import type { DeepReadonly, GameResult, GameRules } from "@si-arena/protocol";
import { SNAKE_CONFIG } from "../constants";
import type {
  SnakeAction,
  SnakeDeathCause,
  SnakeEvent,
  SnakeObservation,
  SnakePosition,
  SnakeState,
} from "../sdk";
import { parseSnakeAction } from "./actions";
import { observeSnake, snakeFinished } from "./observation";
import {
  byIndex,
  cellIndex,
  DEATH_CAUSES,
  DELTAS,
  initSnake,
  parseSnakeState,
  samePoint,
} from "./state";
import { readRecord } from "./validation";

export { parseSnakeAction } from "./actions";
export { parseSnakeState } from "./state";
export { parseSnakeObservation } from "./observation";
export type { SnakeDeathCause, SnakeEvent } from "../sdk";

export interface SnakeResult extends GameResult {
  /** `elimination` once at most one snake is alive, otherwise `tick-limit`. */
  reason: "elimination" | "tick-limit";
  players: Array<{ id: string; rank: number; score: number; alive: boolean }>;
}
export interface SnakeStepResult {
  nextState: SnakeState;
  events: SnakeEvent[];
  result?: SnakeResult;
}
export interface SnakeRules extends GameRules<
  SnakeState,
  SnakeObservation,
  SnakeAction,
  SnakeEvent
> {
  step(
    state: DeepReadonly<SnakeState>,
    actions: DeepReadonly<Record<string, SnakeAction>>,
  ): SnakeStepResult;
}

/** Whether a ranking key [alive, length or death tick] places its snake strictly ahead. */
const ahead = (first: number[], second: number[]) =>
  first[0]! > second[0]! || (first[0] === second[0] && first[1]! > second[1]!);

/**
 * Living snakes rank first by length, the dead after them by death tick, later first.
 * Equal keys share a rank, and each rank is one more than the number of snakes ahead.
 */
function outcome(state: SnakeState): SnakeResult | undefined {
  if (!snakeFinished(state)) return undefined;
  const keys = state.snakes.map((snake) =>
    snake.death ? [0, snake.death.tick] : [1, snake.body.length],
  );
  return {
    reason: state.snakes.filter((snake) => !snake.death).length <= 1 ? "elimination" : "tick-limit",
    completedTicks: state.tick,
    players: state.snakes.map((snake) => ({
      id: snake.id,
      rank: 1 + keys.filter((other) => ahead(other, keys[snake.slot]!)).length,
      score: snake.body.length,
      alive: !snake.death,
    })),
  };
}

function step(
  state: DeepReadonly<SnakeState>,
  rawActions: DeepReadonly<Record<string, SnakeAction>>,
): SnakeStepResult {
  const next = parseSnakeState(state);
  if (snakeFinished(next)) throw new TypeError("Cannot step a finished Snake game");
  const { width, height, snakes } = next;
  const inside = (cell: SnakePosition) =>
    cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height;
  const alive = snakes.filter((snake) => !snake.death);
  const raw = readRecord(
    rawActions,
    alive.map((snake) => snake.id),
    "Snake tick actions",
  );
  const actions = alive.map((snake) => {
    const parsed = parseSnakeAction(raw[snake.id]);
    if (!parsed.ok) throw new TypeError(`Invalid action for ${snake.id}: ${parsed.message}`);
    return parsed.action;
  });
  const events: SnakeEvent[] = [];
  const eats: SnakeEvent[] = [];
  // 1. Health drops before anything moves.
  for (const snake of alive) snake.health--;
  // 2. Every head advances; food on the target restores health and keeps the tail.
  const foodCells = new Set(next.food.map((cell) => cellIndex(width, cell)));
  const eaten = new Set<number>();
  const ate = alive.map((snake, index) => {
    const direction = actions[index]!.direction;
    const from = snake.body[0]!;
    const to = { x: from.x + DELTAS[direction][0], y: from.y + DELTAS[direction][1] };
    snake.heading = direction;
    snake.body.unshift(to);
    events.push({ type: "move", playerId: snake.id, from: { ...from }, to: { ...to } });
    const target = inside(to) ? cellIndex(width, to) : -1;
    if (target >= 0 && foodCells.has(target)) {
      snake.health = SNAKE_CONFIG.maxHealth;
      eaten.add(target);
      eats.push({ type: "eat", playerId: snake.id, position: { ...to } });
      return true;
    }
    snake.body.pop();
    return false;
  });
  events.push(...eats);
  next.food = next.food.filter((cell) => !eaten.has(cellIndex(width, cell)));
  // 3. Deaths are judged together on the moved bodies, in the fixed cause order.
  const segments = new Set<number>();
  for (const snake of alive)
    for (let index = 1; index < snake.body.length; index++)
      segments.add(cellIndex(width, snake.body[index]!));
  const causes = alive.map((snake, index) => {
    const list: SnakeDeathCause[] = [];
    const head = snake.body[0]!;
    if (!inside(head)) list.push("boundary");
    if (snake.health === 0 && !ate[index]) list.push("starvation");
    if (inside(head) && segments.has(cellIndex(width, head))) list.push("body-collision");
    if (
      alive.some(
        (other) =>
          other !== snake &&
          samePoint(other.body[0]!, head) &&
          other.body.length >= snake.body.length,
      )
    )
      list.push("head-collision");
    return DEATH_CAUSES.filter((cause) => list.includes(cause));
  });
  // 4. The dead leave the map.
  const tick = next.tick + 1;
  alive.forEach((snake, index) => {
    const list = causes[index]!;
    if (list.length === 0) return;
    events.push({
      type: "death",
      playerId: snake.id,
      position: { ...snake.body[0]! },
      causes: list,
    });
    snake.body = [];
    snake.health = 0;
    snake.death = { tick, causes: [...list] };
  });
  // 5. Food is topped up to the number of living snakes, at least one, with a 15% bonus piece.
  const living = snakes.filter((snake) => !snake.death).length;
  if (next.food.length < Math.max(1, living)) {
    let rngState = next.rngState;
    const draw = () => {
      rngState ^= rngState << 13;
      rngState ^= rngState >>> 17;
      rngState ^= rngState << 5;
      rngState >>>= 0;
      return rngState;
    };
    const spawn = () => {
      const taken = new Set(next.food.map((cell) => cellIndex(width, cell)));
      for (const snake of snakes) for (const cell of snake.body) taken.add(cellIndex(width, cell));
      const empty: number[] = [];
      for (let cell = 0; cell < width * height; cell++) if (!taken.has(cell)) empty.push(cell);
      if (empty.length === 0) return false;
      const pick = empty[draw() % empty.length]!;
      const position = { x: pick % width, y: Math.floor(pick / width) };
      next.food.push(position);
      next.food.sort(byIndex(width));
      events.push({ type: "food-spawn", position: { ...position } });
      return true;
    };
    if (spawn() && draw() % 100 < SNAKE_CONFIG.extraFoodPercent) spawn();
    next.rngState = rngState;
  }
  // 6. Advance; the game ends with at most one survivor or at the tick limit.
  next.tick = tick;
  const result = outcome(next);
  return result ? { nextState: next, events, result } : { nextState: next, events };
}

export const snakeRules: SnakeRules = {
  init: initSnake,
  observe: observeSnake,
  parseAction: parseSnakeAction,
  defaultAction(state, playerId) {
    const snake = state.snakes.find((candidate) => candidate.id === playerId);
    if (!snake) throw new TypeError("Unknown Snake player");
    return { type: "move", direction: snake.heading };
  },
  step,
};
