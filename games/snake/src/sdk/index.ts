import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import type { SNAKE_MAX_TICKS } from "../constants";

export type SnakeDirection = "up" | "right" | "down" | "left";
export type SnakeAction = { type: "move"; direction: SnakeDirection };
export type SnakePosition = { x: number; y: number };

/** Death causes in their fixed reporting order. */
export type SnakeDeathCause = "boundary" | "starvation" | "body-collision" | "head-collision";

export interface SnakeDeath {
  /** Completed tick count when the snake died. */
  tick: number;
  causes: SnakeDeathCause[];
}

export interface Snake {
  id: string;
  slot: number;
  /** Cells from head to tail; empty once dead. Stacked segments only occur at the tail. */
  body: SnakePosition[];
  /** Direction of the last move, or the spawn facing at tick 0. */
  heading: SnakeDirection;
  /** 1–100 while alive, 0 once dead. */
  health: number;
  /** Null while alive. */
  death: SnakeDeath | null;
}

export interface SnakeState {
  tick: number;
  /** Square map; the side depends on the number of players. */
  width: number;
  height: number;
  maxTicks: typeof SNAKE_MAX_TICKS;
  snakes: Snake[];
  /** Food cells in ascending index order (y * width + x). */
  food: SnakePosition[];
  rngState: number;
}

export type SnakeEvent =
  | { type: "move"; playerId: string; from: SnakePosition; to: SnakePosition }
  | { type: "eat"; playerId: string; position: SnakePosition }
  | { type: "death"; playerId: string; position: SnakePosition; causes: SnakeDeathCause[] }
  | { type: "food-spawn"; position: SnakePosition };

export interface SnakeBoard {
  width: number;
  height: number;
}
export interface SnakeVisibleSnake {
  id: string;
  slot: number;
  body: SnakePosition[];
  /** Equals body[0]. */
  head: SnakePosition;
  /** Equals body.length. */
  length: number;
  health: number;
  heading: SnakeDirection;
}
export interface SnakeEliminated {
  id: string;
  slot: number;
  /** Completed tick count when the snake died. */
  tick: number;
  causes: SnakeDeathCause[];
}
/** Public facts only; independent of the engine's internal state layout. */
export interface SnakeObservation {
  tick: number;
  maxTicks: typeof SNAKE_MAX_TICKS;
  selfId: string;
  selfSlot: number;
  board: SnakeBoard;
  /** Living snakes, including self, by slot. */
  snakes: SnakeVisibleSnake[];
  /** Eliminated snakes by slot. */
  eliminated: SnakeEliminated[];
  food: SnakePosition[];
  events: SnakeEvent[];
}
export interface SnakeSelf extends DeepReadonly<SnakeVisibleSnake> {
  /** Register an intent; the body stays unchanged until simultaneous settlement. */
  move(direction: SnakeDirection): void;
}
export interface SnakeGameView {
  readonly tick: number;
  readonly maxTicks: typeof SNAKE_MAX_TICKS;
  readonly board: DeepReadonly<SnakeBoard>;
  readonly self: SnakeSelf;
  /** Living opponents by slot. */
  readonly opponents: DeepReadonly<SnakeVisibleSnake[]>;
  readonly eliminated: DeepReadonly<SnakeEliminated[]>;
  readonly food: DeepReadonly<SnakePosition[]>;
  /** Public events from the preceding tick, empty at tick 0. */
  readonly events: DeepReadonly<SnakeEvent[]>;
}
export interface SnakeTickInput {
  readonly game: SnakeGameView;
  /** JSON recovery checkpoint. Globals and SDK caches are lost when a tick fails. */
  readonly Memory: JsonObject;
}
export { SNAKE_SDK_SOURCE } from "./source";
