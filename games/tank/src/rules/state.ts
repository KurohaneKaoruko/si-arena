import { isJsonSnapshot, type DeepReadonly, type InitInput } from "@si-arena/protocol";
import { TANK_CELLS, TANK_CONFIG, TANK_MAX_TICKS, TANK_PLAYERS, TANK_SPAWNS } from "../constants";
import type { TankBullet, TankDirection, TankPosition, TankState, TankUnit } from "../sdk";
import { readArray, readId, readInteger, readRecord } from "./validation";

export const DIRECTIONS: readonly TankDirection[] = ["up", "right", "down", "left"];
export const DELTAS = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] } as const;
const { width: WIDTH, height: HEIGHT } = TANK_CONFIG;

export const cellIndex = (position: TankPosition) => position.y * WIDTH + position.x;
export const samePosition = (first: TankPosition, second: TankPosition) =>
  first.x === second.x && first.y === second.y;
export const insideMap = (position: TankPosition) =>
  position.x >= 0 && position.y >= 0 && position.x < WIDTH && position.y < HEIGHT;

export function readDirection(raw: unknown, label: string): TankDirection {
  if (raw !== "up" && raw !== "right" && raw !== "down" && raw !== "left")
    throw new TypeError(`${label} must be up, right, down or left`);
  return raw;
}

export function readPosition(raw: unknown, label: string): TankPosition {
  const point = readRecord(raw, ["x", "y"], label);
  return {
    x: readInteger(point.x, 0, WIDTH - 1, `${label}.x`),
    y: readInteger(point.y, 0, HEIGHT - 1, `${label}.y`),
  };
}

/** Frozen terrain arrays that passed validation. */
const validCells = new WeakSet<object>();

/**
 * Validate terrain of 0 (empty), 1 (brick) or 2 (steel). A frozen array is validated once.
 * With `share`, an engine snapshot is returned as is (read-only); anything else is a copy.
 */
export function readCells(raw: unknown, label: string, share: boolean): number[] {
  if (!(Array.isArray(raw) && raw.length === TANK_CELLS && validCells.has(raw))) {
    for (const cell of readArray(raw, TANK_CELLS, label)) readInteger(cell, 0, 2, label);
    if (Object.isFrozen(raw)) validCells.add(raw as object);
  }
  if (isJsonSnapshot(raw)) return share ? (raw as number[]) : Array.from(raw as number[]);
  return (raw as number[]).map((cell) => (cell === 0 ? 0 : cell));
}

/** Indices of the empty square centred on a slot's spawn. */
export function spawnArea(slot: number): number[] {
  const spawn = TANK_SPAWNS[slot]!;
  const half = (TANK_CONFIG.spawnClearance - 1) / 2;
  const area: number[] = [];
  for (let dy = -half; dy <= half; dy++)
    for (let dx = -half; dx <= half; dx++) area.push((spawn.y + dy) * WIDTH + spawn.x + dx);
  return area;
}

export function parseTankState(raw: unknown): TankState {
  return readTankState(raw, false);
}

/** parseTankState for read-only use: engine snapshot terrain is shared, not copied. */
const validatedStates = new WeakMap<object, DeepReadonly<TankState>>();

export function viewTankState(raw: unknown): DeepReadonly<TankState> {
  const known = raw !== null && typeof raw === "object" && isJsonSnapshot(raw);
  if (known) {
    const cached = validatedStates.get(raw as object);
    if (cached) return cached;
  }
  const result = readTankState(raw, true);
  if (known) {
    const frozen = raw as DeepReadonly<TankState>;
    validatedStates.set(raw as object, frozen);
    return frozen;
  }
  return result;
}

function readTankState(raw: unknown, share: boolean): TankState {
  const value = readRecord(
    raw,
    ["tick", "width", "height", "maxTicks", "cells", "tanks", "bullets", "rngState"],
    "Tank state",
  );
  if (value.width !== WIDTH || value.height !== HEIGHT || value.maxTicks !== TANK_MAX_TICKS)
    throw new TypeError("Tank state must use the published map size and tick limit");
  const tick = readInteger(value.tick, 0, TANK_MAX_TICKS, "tick");
  const cells = readCells(value.cells, "cells", share);
  for (let slot = 0; slot < TANK_PLAYERS; slot++)
    for (const index of spawnArea(slot))
      if (cells[index] !== 0) throw new TypeError("Spawn areas stay empty");
  const tanks = readArray(value.tanks, TANK_PLAYERS, "tanks").map((rawTank, slot) => {
    const tank = readRecord(rawTank, ["id", "slot", "position", "facing", "hp", "death"], "tank");
    if (tank.slot !== slot) throw new TypeError("Tanks are listed by slot");
    const unit: TankUnit = {
      id: readId(tank.id),
      slot,
      position: null,
      facing: readDirection(tank.facing, "facing"),
      hp: 0,
      death: null,
    };
    if (tank.death === null) {
      unit.position = readPosition(tank.position, "position");
      unit.hp = readInteger(tank.hp, 1, TANK_CONFIG.initialHp, "hp");
      if (cells[cellIndex(unit.position)] !== 0)
        throw new TypeError("A tank stands on an empty cell");
    } else {
      const death = readRecord(tank.death, ["tick"], "death");
      // A destroyed tank ends the match, so it can only have died on the last settled tick.
      if (readInteger(death.tick, 1, tick, "death.tick") !== tick)
        throw new TypeError("A destroyed tank ends the match");
      if (tank.position !== null || tank.hp !== 0)
        throw new TypeError("A destroyed tank is removed and has no hp");
      unit.death = { tick };
    }
    return unit;
  });
  if (tanks[0]!.id === tanks[1]!.id) throw new TypeError("Tank IDs must be distinct");
  if (
    tanks[0]!.position &&
    tanks[1]!.position &&
    samePosition(tanks[0]!.position, tanks[1]!.position)
  )
    throw new TypeError("Tanks occupy distinct cells");
  if (!Array.isArray(value.bullets) || value.bullets.length > TANK_PLAYERS)
    throw new TypeError("At most one bullet per tank is in flight");
  const owners = new Set<number>();
  const bullets = readArray(value.bullets, value.bullets.length, "bullets").map((rawBullet) => {
    const bullet = readRecord(rawBullet, ["position", "direction", "owner"], "bullet");
    const owner = readInteger(bullet.owner, 0, TANK_PLAYERS - 1, "owner");
    if (owners.has(owner) || tanks[owner]!.death)
      throw new TypeError("Each living tank has at most one bullet");
    owners.add(owner);
    const position = readPosition(bullet.position, "bullet position");
    if (cells[cellIndex(position)] !== 0) throw new TypeError("Bullets fly over empty cells");
    return { position, direction: readDirection(bullet.direction, "bullet direction"), owner };
  }) satisfies TankBullet[];
  return {
    tick,
    width: WIDTH,
    height: HEIGHT,
    maxTicks: TANK_MAX_TICKS,
    cells,
    tanks,
    bullets,
    rngState: readInteger(value.rngState, 1, 0xffffffff, "rngState"),
  };
}

/** Whether the two spawns are joined by a four-neighbour path over non-steel cells. */
export function spawnsConnected(cells: readonly number[]): boolean {
  const start = TANK_SPAWNS[0]!.y * WIDTH + TANK_SPAWNS[0]!.x;
  const goal = TANK_SPAWNS[1]!.y * WIDTH + TANK_SPAWNS[1]!.x;
  const seen = new Uint8Array(TANK_CELLS);
  const queue = [start];
  seen[start] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor]!;
    if (index === goal) return true;
    const x = index % WIDTH;
    const y = (index / WIDTH) | 0;
    for (const direction of DIRECTIONS) {
      const nx = x + DELTAS[direction][0];
      const ny = y + DELTAS[direction][1];
      if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT) continue;
      const next = ny * WIDTH + nx;
      if (seen[next] || cells[next] === 2) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return false;
}

export function initTank(input: InitInput): TankState {
  const config = readRecord(input.config, Object.keys(TANK_CONFIG), "Tank config");
  for (const [key, expected] of Object.entries(TANK_CONFIG))
    if (config[key] !== expected) throw new TypeError(`Unsupported Tank config: ${key}`);
  const seats: { id: string; slot: number }[] = [];
  for (const rawPlayer of readArray(input.players, TANK_PLAYERS, "players")) {
    const player = readRecord(rawPlayer, ["id", "slot"], "initial player");
    const slot = readInteger(player.slot, 0, TANK_PLAYERS - 1, "slot");
    const id = readId(player.id);
    if (seats[slot] || seats.some((seat) => seat?.id === id))
      throw new TypeError("Tank requires distinct IDs and slots 0..1");
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
  for (let warmUp = 0; warmUp < 4; warmUp++) next();
  let cells: number[] = [];
  for (let attempt = 0; attempt < TANK_CONFIG.maxGenerations; attempt++) {
    cells = Array<number>(TANK_CELLS).fill(0);
    // Every cell of the left half (x <= 10) draws once, in index order.
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x <= (WIDTH - 1) / 2; x++) {
        const r = next() % 100;
        cells[y * WIDTH + x] =
          r < TANK_CONFIG.steelPercent ? 2 : r < TANK_CONFIG.brickPercent ? 1 : 0;
      }
    // The rest mirrors through the centre; the lower half of the centre column too, so
    // its own draws are discarded and the map is point-symmetric.
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++)
        if (x > (WIDTH - 1) / 2 || (x === (WIDTH - 1) / 2 && y > (HEIGHT - 1) / 2))
          cells[y * WIDTH + x] = cells[(HEIGHT - 1 - y) * WIDTH + (WIDTH - 1 - x)]!;
    for (let slot = 0; slot < TANK_PLAYERS; slot++)
      for (const index of spawnArea(slot)) cells[index] = 0;
    if (spawnsConnected(cells)) break;
  }
  if (!spawnsConnected(cells)) cells = cells.map((cell) => (cell === 2 ? 1 : cell));
  return {
    tick: 0,
    width: WIDTH,
    height: HEIGHT,
    maxTicks: TANK_MAX_TICKS,
    cells,
    tanks: seats.map(({ id, slot }) => {
      const spawn = TANK_SPAWNS[slot]!;
      return {
        id,
        slot,
        position: { x: spawn.x, y: spawn.y },
        facing: spawn.facing,
        hp: TANK_CONFIG.initialHp,
        death: null,
      };
    }),
    bullets: [],
    rngState,
  };
}
