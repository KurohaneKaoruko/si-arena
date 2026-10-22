import { isJsonSnapshot, type DeepReadonly, type InitInput } from "@si-arena/protocol";
import {
  SNAKE_CONFIG,
  SNAKE_MAX_PLAYERS,
  SNAKE_MAX_TICKS,
  SNAKE_MIN_PLAYERS,
  snakeMapSize,
} from "../constants";
import type {
  Snake,
  SnakeDeath,
  SnakeDeathCause,
  SnakeDirection,
  SnakePosition,
  SnakeState,
} from "../sdk";
import { readArray, readId, readInteger, readRecord } from "./validation";

export const DEATH_CAUSES: readonly SnakeDeathCause[] = [
  "boundary",
  "starvation",
  "body-collision",
  "head-collision",
];
export const DIRECTIONS: readonly SnakeDirection[] = ["up", "right", "down", "left"];
export const DELTAS: Record<SnakeDirection, readonly [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};

export const samePoint = (a: SnakePosition, b: SnakePosition) => a.x === b.x && a.y === b.y;

export function readPosition(raw: unknown, size: number, label: string): SnakePosition {
  const point = readRecord(raw, ["x", "y"], label);
  return {
    x: readInteger(point.x, 0, size - 1, `${label}.x`),
    y: readInteger(point.y, 0, size - 1, `${label}.y`),
  };
}

/** A move target: at most one cell beyond the map, where a boundary death is reported. */
export function readTarget(raw: unknown, size: number, label: string): SnakePosition {
  const point = readRecord(raw, ["x", "y"], label);
  return {
    x: readInteger(point.x, -1, size, `${label}.x`),
    y: readInteger(point.y, -1, size, `${label}.y`),
  };
}

export function readDirection(raw: unknown, label: string): SnakeDirection {
  if (!DIRECTIONS.includes(raw as SnakeDirection))
    throw new TypeError(`${label} must be up, right, down or left`);
  return raw as SnakeDirection;
}

export function readCauses(raw: unknown): SnakeDeathCause[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > DEATH_CAUSES.length)
    throw new TypeError("Invalid death causes");
  let previous = -1;
  return readArray(raw, raw.length, "causes").map((cause) => {
    const order = DEATH_CAUSES.indexOf(cause as SnakeDeathCause);
    if (order <= previous) throw new TypeError("Death causes must be known, unique and ordered");
    previous = order;
    return cause as SnakeDeathCause;
  });
}

export function readPlayerCount(raw: unknown, label: string): number {
  if (!Array.isArray(raw) || raw.length < SNAKE_MIN_PLAYERS || raw.length > SNAKE_MAX_PLAYERS)
    throw new TypeError(`${label} must list ${SNAKE_MIN_PLAYERS}–${SNAKE_MAX_PLAYERS} players`);
  return raw.length;
}

/** Cells occupied by living bodies; a cell held by two snakes is a collision that never stands. */
export type Occupied = Set<number>;

/**
 * Validate a living body: in-bounds cells from head to tail, consecutive segments adjacent or
 * stacked, stacking only at the tail, no cell used twice, the head following the heading, and no
 * cell shared with another snake. With `share`, an engine snapshot body is returned as is.
 */
export function readBody(
  raw: unknown,
  side: number,
  heading: SnakeDirection,
  occupied: Occupied,
  label: string,
  share: boolean,
): SnakePosition[] {
  if (!Array.isArray(raw) || raw.length < SNAKE_CONFIG.initialLength || raw.length > side * side)
    throw new TypeError(`${label} must hold at least ${SNAKE_CONFIG.initialLength} segments`);
  const body = readArray(raw, raw.length, label).map((cell, index) =>
    readPosition(cell, side, `${label}[${index}]`),
  );
  let stacked = false;
  for (let index = 0; index < body.length; index++) {
    const cell = body[index]!;
    const previous = body[index - 1];
    if (previous) {
      if (samePoint(previous, cell)) {
        stacked = true;
        continue;
      }
      if (stacked || Math.abs(previous.x - cell.x) + Math.abs(previous.y - cell.y) !== 1)
        throw new TypeError(`${label} must be a chain of adjacent cells stacked only at the tail`);
    }
    const key = cell.y * side + cell.x;
    if (occupied.has(key)) throw new TypeError(`${label} overlaps another segment`);
    occupied.add(key);
  }
  const head = body[0]!;
  const neck = body[1]!;
  const [dx, dy] = DELTAS[heading];
  if (!samePoint(head, neck) && (head.x - neck.x !== dx || head.y - neck.y !== dy))
    throw new TypeError(`${label} head does not follow its heading`);
  return share && isJsonSnapshot(raw) ? (raw as SnakePosition[]) : body;
}

/** Validate food: distinct in-bounds cells in ascending index order, none under a body. */
export function readFood(
  raw: unknown,
  side: number,
  occupied: Occupied,
  share: boolean,
): SnakePosition[] {
  if (!Array.isArray(raw) || raw.length > side * side) throw new TypeError("Invalid food list");
  let previous = -1;
  const food = readArray(raw, raw.length, "food").map((cell, index) => {
    const point = readPosition(cell, side, `food[${index}]`);
    const key = point.y * side + point.x;
    if (key <= previous || occupied.has(key))
      throw new TypeError("Food must be in ascending order on empty cells");
    previous = key;
    return point;
  });
  return share && isJsonSnapshot(raw) ? (raw as SnakePosition[]) : food;
}

export function parseSnakeState(raw: unknown): SnakeState {
  return readSnakeState(raw, false);
}

/** parseSnakeState for read-only use: engine snapshot lists are shared, not copied. */
const validatedStates = new WeakMap<object, DeepReadonly<SnakeState>>();

export function viewSnakeState(raw: unknown): DeepReadonly<SnakeState> {
  const known = raw !== null && typeof raw === "object" && isJsonSnapshot(raw);
  if (known) {
    const cached = validatedStates.get(raw as object);
    if (cached) return cached;
  }

  const result = readSnakeState(raw, true);

  if (known) {
    const frozen = raw as DeepReadonly<SnakeState>;
    validatedStates.set(raw as object, frozen);
    return frozen;
  }
  return result;
}

function readSnakeState(raw: unknown, share: boolean): SnakeState {
  const value = readRecord(
    raw,
    ["tick", "width", "height", "maxTicks", "snakes", "food", "rngState"],
    "Snake state",
  );
  const count = readPlayerCount(value.snakes, "Snake state");
  const side = snakeMapSize(count);
  if (value.width !== side || value.height !== side || value.maxTicks !== SNAKE_MAX_TICKS)
    throw new TypeError("Snake state must use the published map size and tick limit");
  const tick = readInteger(value.tick, 0, SNAKE_MAX_TICKS, "tick");
  const occupied: Occupied = new Set();
  const ids = new Set<string>();
  const snakes = readArray(value.snakes, count, "snakes").map((rawSnake, slot): Snake => {
    const snake = readRecord(
      rawSnake,
      ["id", "slot", "body", "heading", "health", "death"],
      "snake",
    );
    if (snake.slot !== slot) throw new TypeError("Snakes are listed by slot");
    const id = readId(snake.id);
    if (ids.has(id)) throw new TypeError("Snake IDs must be distinct");
    ids.add(id);
    const heading = readDirection(snake.heading, "heading");
    let death: SnakeDeath | null = null;
    if (snake.death !== null) {
      const entry = readRecord(snake.death, ["tick", "causes"], "death");
      death = {
        tick: readInteger(entry.tick, 1, tick, "death.tick"),
        causes: readCauses(entry.causes),
      };
    }
    if (death) {
      if (!Array.isArray(snake.body) || snake.body.length !== 0 || snake.health !== 0)
        throw new TypeError("A dead snake has no body and no health");
      return { id, slot, body: [], heading, health: 0, death };
    }
    return {
      id,
      slot,
      body: readBody(snake.body, side, heading, occupied, "body", share),
      heading,
      health: readInteger(snake.health, 1, SNAKE_CONFIG.maxHealth, "health"),
      death: null,
    };
  });
  return {
    tick,
    width: side,
    height: side,
    maxTicks: SNAKE_MAX_TICKS,
    snakes,
    food: readFood(value.food, side, occupied, share),
    rngState: readInteger(value.rngState, 1, 0xffffffff, "rngState"),
  };
}

export const cellIndex = (side: number, cell: SnakePosition) => cell.y * side + cell.x;
export const byIndex = (side: number) => (a: SnakePosition, b: SnakePosition) =>
  cellIndex(side, a) - cellIndex(side, b);

export function initSnake(input: InitInput): SnakeState {
  const config = readRecord(input.config, Object.keys(SNAKE_CONFIG), "Snake config");
  for (const [key, expected] of Object.entries(SNAKE_CONFIG))
    if (config[key] !== expected) throw new TypeError(`Unsupported Snake config: ${key}`);
  const count = readPlayerCount(input.players, "Snake init");
  const seats: { id: string; slot: number }[] = [];
  for (const rawPlayer of readArray(input.players, count, "players")) {
    const player = readRecord(rawPlayer, ["id", "slot"], "initial player");
    const slot = readInteger(player.slot, 0, count - 1, "slot");
    const id = readId(player.id);
    if (seats[slot] || seats.some((seat) => seat?.id === id))
      throw new TypeError("Snake requires distinct IDs and slots 0..n-1");
    seats[slot] = { id, slot };
  }
  let rngState = readInteger(input.seed, 0, 0xffffffff, "seed") || 0x9e3779b9;
  const next = () => {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    rngState >>>= 0;
    return rngState;
  };
  // Small seeds keep xorshift32 near zero for a few outputs; skip them so nearby seeds
  // (such as consecutive local runs) shuffle the corners differently.
  for (let warmUp = 0; warmUp < 4; warmUp++) next();
  const side = snakeMapSize(count);
  const far = side - 3;
  const corners: SnakePosition[] = [
    { x: 2, y: 2 },
    { x: far, y: 2 },
    { x: 2, y: far },
    { x: far, y: far },
  ];
  // Fisher–Yates: the seed decides which seat starts in which corner.
  for (let index = corners.length - 1; index > 0; index--) {
    const other = next() % (index + 1);
    [corners[index], corners[other]] = [corners[other]!, corners[index]!];
  }
  const centre = (side - 1) / 2;
  const towards = (from: number) => from + 2 * Math.sign(centre - from);
  const food: SnakePosition[] = [{ x: centre, y: centre }];
  const snakes = seats.map(({ id, slot }): Snake => {
    const spawn = corners[slot]!;
    food.push({ x: towards(spawn.x), y: towards(spawn.y) });
    return {
      id,
      slot,
      body: Array.from({ length: SNAKE_CONFIG.initialLength }, () => ({ ...spawn })),
      heading: spawn.x < side / 2 ? "right" : "left",
      health: SNAKE_CONFIG.maxHealth,
      death: null,
    };
  });
  food.sort(byIndex(side));
  return { tick: 0, width: side, height: side, maxTicks: SNAKE_MAX_TICKS, snakes, food, rngState };
}
