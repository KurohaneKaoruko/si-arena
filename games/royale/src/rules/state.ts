import { isJsonSnapshot, type DeepReadonly, type InitInput } from "@si-arena/protocol";
import {
  ROYALE_CONFIG,
  ROYALE_MAX_PLAYERS,
  ROYALE_MAX_TICKS,
  ROYALE_MIN_PLAYERS,
  royaleMapSize,
  royaleZoneTarget,
} from "../constants";
import type {
  RoyaleDeath,
  RoyaleDeathCause,
  RoyalePlayer,
  RoyalePosition,
  RoyaleState,
} from "../sdk";
import { readArray, readId, readInteger, readRecord } from "./validation";

export const DEATH_CAUSES: readonly RoyaleDeathCause[] = [
  "boundary",
  "head-collision",
  "head-swap",
  "self-trail",
  "trail-cut",
  "enclosed",
  "zone",
];

/** Frozen grids that passed validation, with their largest cell value. */
const validGrids = new WeakMap<object, number>();

/**
 * Validate a grid of -1 or player slots. A frozen grid is validated once. With `share`, an
 * engine snapshot grid is returned as is (read-only); anything else is a detached copy.
 */
export function readGrid(
  raw: unknown,
  length: number,
  players: number,
  label: string,
  share: boolean,
): number[] {
  // Only frozen grids are cached, so a hit can never have changed since it was checked.
  const known = Array.isArray(raw) && raw.length === length ? validGrids.get(raw) : undefined;
  if (known === undefined || known >= players) {
    let max = -1;
    for (const cell of readArray(raw, length, label)) {
      const value = readInteger(cell, -1, players - 1, label);
      if (value > max) max = value;
    }
    if (Object.isFrozen(raw)) validGrids.set(raw as object, max);
  }
  if (isJsonSnapshot(raw)) return share ? (raw as number[]) : Array.from(raw as number[]);
  return (raw as number[]).map((cell) => (cell === 0 ? 0 : cell));
}

export function readPosition(raw: unknown, size: number, label: string): RoyalePosition {
  const point = readRecord(raw, ["x", "y"], label);
  return {
    x: readInteger(point.x, 0, size - 1, `${label}.x`),
    y: readInteger(point.y, 0, size - 1, `${label}.y`),
  };
}

export function readCauses(raw: unknown): RoyaleDeathCause[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > DEATH_CAUSES.length)
    throw new TypeError("Invalid death causes");
  let previous = -1;
  return readArray(raw, raw.length, "causes").map((cause) => {
    const order = DEATH_CAUSES.indexOf(cause as RoyaleDeathCause);
    if (order <= previous) throw new TypeError("Death causes must be known, unique and ordered");
    previous = order;
    return cause as RoyaleDeathCause;
  });
}

export function readPlayerCount(raw: unknown, label: string): number {
  if (!Array.isArray(raw) || raw.length < ROYALE_MIN_PLAYERS || raw.length > ROYALE_MAX_PLAYERS)
    throw new TypeError(`${label} must list ${ROYALE_MIN_PLAYERS}–${ROYALE_MAX_PLAYERS} players`);
  return raw.length;
}

/** First zone cell on both axes for a zone side on this map. */
export function zoneMin(width: number, zoneSize: number): number {
  return (width - zoneSize) / 2;
}

export function insideZone(width: number, zoneSize: number, x: number, y: number): boolean {
  const min = zoneMin(width, zoneSize);
  return x >= min && y >= min && x < min + zoneSize && y < min + zoneSize;
}

export function parseRoyaleState(raw: unknown): RoyaleState {
  return readRoyaleState(raw, false);
}

/** parseRoyaleState for read-only use: engine snapshot grids are shared, not copied. */
const validatedStates = new WeakMap<object, DeepReadonly<RoyaleState>>();

export function viewRoyaleState(raw: unknown): DeepReadonly<RoyaleState> {
  const known = raw !== null && typeof raw === "object" && isJsonSnapshot(raw);
  if (known) {
    const cached = validatedStates.get(raw as object);
    if (cached) return cached;
  }

  const result = readRoyaleState(raw, true);

  if (known) {
    const frozen = raw as DeepReadonly<RoyaleState>;
    validatedStates.set(raw as object, frozen);
    return frozen;
  }
  return result;
}

function readRoyaleState(raw: unknown, share: boolean): RoyaleState {
  const value = readRecord(
    raw,
    [
      "tick",
      "width",
      "height",
      "maxTicks",
      "zoneSize",
      "territory",
      "trails",
      "players",
      "rngState",
    ],
    "Royale state",
  );
  const count = readPlayerCount(value.players, "Royale state");
  const side = royaleMapSize(count);
  if (value.width !== side || value.height !== side || value.maxTicks !== ROYALE_MAX_TICKS)
    throw new TypeError("Royale state must use the published map size and tick limit");
  const tick = readInteger(value.tick, 0, ROYALE_MAX_TICKS, "tick");
  const players = readArray(value.players, count, "players").map((rawPlayer, slot) => {
    const player = readRecord(rawPlayer, ["id", "slot", "spawn", "position", "death"], "player");
    if (player.slot !== slot) throw new TypeError("Royale players are listed by slot");
    let death: RoyaleDeath | null = null;
    if (player.death !== null) {
      const entry = readRecord(player.death, ["tick", "causes"], "death");
      death = {
        tick: readInteger(entry.tick, 1, tick, "death.tick"),
        causes: readCauses(entry.causes),
      };
    }
    const position = death ? null : readPosition(player.position, side, "position");
    if (death && player.position !== null) throw new TypeError("An eliminated head is removed");
    return {
      id: readId(player.id),
      slot,
      spawn: readPosition(player.spawn, side, "spawn"),
      position,
      death,
    } satisfies RoyalePlayer;
  });
  const territory = readGrid(value.territory, side * side, count, "territory", share);
  const trails = readGrid(value.trails, side * side, count, "trails", share);
  const alive = players.filter((player) => player.position !== null);
  const zoneSize = readInteger(value.zoneSize, 1, side, "zoneSize");
  if ((side - zoneSize) % 2 !== 0 || zoneSize < royaleZoneTarget(alive.length) - 1)
    throw new TypeError("Invalid safe-zone size");
  const ids = new Set<string>();
  const spawns = new Set<number>();
  const heads = new Set<number>();
  for (const player of players) {
    ids.add(player.id);
    spawns.add(player.spawn.y * side + player.spawn.x);
    if (player.position) heads.add(player.position.y * side + player.position.x);
  }
  if (ids.size !== count || spawns.size !== count || heads.size !== alive.length)
    throw new TypeError("Royale IDs, spawns and living heads must be distinct");
  for (let cell = 0; cell < territory.length; cell++) {
    const land = territory[cell]!;
    const trail = trails[cell]!;
    if (land < 0 && trail < 0) continue;
    if (
      (land >= 0 && players[land]!.death) ||
      (trail >= 0 && players[trail]!.death) ||
      land === trail ||
      !insideZone(side, zoneSize, cell % side, (cell / side) | 0)
    )
      throw new TypeError(
        "Only living players own cells, only inside the zone, and no trail on own land",
      );
  }
  for (const player of alive) {
    const { x, y } = player.position!;
    if (!insideZone(side, zoneSize, x, y)) throw new TypeError("A living head is in the safe zone");
    const index = y * side + x;
    if (territory[index] === player.slot) {
      if (trails.includes(player.slot))
        throw new TypeError("A head inside its territory cannot retain a trail");
    } else if (trails[index] !== player.slot) {
      throw new TypeError("A head outside its territory must be on its own trail");
    }
  }
  return {
    tick,
    width: side,
    height: side,
    maxTicks: ROYALE_MAX_TICKS,
    zoneSize,
    territory,
    trails,
    players,
    rngState: readInteger(value.rngState, 1, 0xffffffff, "rngState"),
  };
}

/**
 * sin and cos from a Taylor series. Only + - * / are used, which IEEE 754 rounds
 * identically on every engine, unlike the implementation-defined Math.sin/Math.cos.
 */
function sinCos(angle: number): [number, number] {
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  let sin = 0;
  let cos = 0;
  let term = 1;
  for (let k = 0; k < 28; k++) {
    if (k % 4 === 0) cos += term;
    else if (k % 4 === 1) sin += term;
    else if (k % 4 === 2) cos -= term;
    else sin -= term;
    term = (term * a) / (k + 1);
  }
  return [sin, cos];
}

export function initRoyale(input: InitInput): RoyaleState {
  const config = readRecord(input.config, Object.keys(ROYALE_CONFIG), "Royale config");
  for (const [key, expected] of Object.entries(ROYALE_CONFIG))
    if (config[key] !== expected) throw new TypeError(`Unsupported Royale config: ${key}`);
  const count = readPlayerCount(input.players, "Royale init");
  const seats: { id: string; slot: number }[] = [];
  for (const rawPlayer of readArray(input.players, count, "players")) {
    const player = readRecord(rawPlayer, ["id", "slot"], "initial player");
    const slot = readInteger(player.slot, 0, count - 1, "slot");
    const id = readId(player.id);
    if (seats[slot] || seats.some((seat) => seat?.id === id))
      throw new TypeError("Royale requires distinct IDs and slots 0..n-1");
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
  // (such as consecutive local runs) start at well-spread angles.
  for (let warmUp = 0; warmUp < 4; warmUp++) next();
  const side = royaleMapSize(count);
  const radius = 0.32 * side;
  const start = (next() / 2 ** 32) * 2 * Math.PI;
  const spawns = Array.from({ length: count }, (_, index): RoyalePosition => {
    const [sin, cos] = sinCos(start + (index * 2 * Math.PI) / count);
    return { x: Math.floor(side / 2 + radius * cos), y: Math.floor(side / 2 + radius * sin) };
  });
  // Fisher–Yates: the seed decides which seat starts on which spawn.
  for (let index = count - 1; index > 0; index--) {
    const other = next() % (index + 1);
    [spawns[index], spawns[other]] = [spawns[other]!, spawns[index]!];
  }
  const state: RoyaleState = {
    tick: 0,
    width: side,
    height: side,
    maxTicks: ROYALE_MAX_TICKS,
    zoneSize: side,
    territory: Array<number>(side * side).fill(-1),
    trails: Array<number>(side * side).fill(-1),
    players: seats.map(({ id, slot }) => {
      const spawn = spawns[slot]!;
      return { id, slot, spawn, position: { ...spawn }, death: null };
    }),
    rngState,
  };
  const half = (ROYALE_CONFIG.initialTerritorySize - 1) / 2;
  for (const { slot, spawn } of state.players)
    for (let dy = -half; dy <= half; dy++)
      for (let dx = -half; dx <= half; dx++)
        state.territory[(spawn.y + dy) * side + spawn.x + dx] = slot;
  return state;
}

/** Territory cells per slot. */
const areaCache = new WeakMap<object, Map<number, readonly number[]>>();
export function royaleAreas(territory: readonly number[], players: number): readonly number[] {
  const known = isJsonSnapshot(territory);
  const cached = known ? areaCache.get(territory)?.get(players) : undefined;
  if (cached) return cached;
  const areas = Array<number>(players).fill(0);
  for (const owner of territory) if (owner >= 0) areas[owner]!++;
  if (known) {
    const entries = areaCache.get(territory) ?? new Map<number, readonly number[]>();
    entries.set(players, Object.freeze(areas));
    areaCache.set(territory, entries);
  }
  return areas;
}
