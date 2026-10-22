import { isJsonSnapshot, type DeepReadonly, type InitInput } from "@si-arena/protocol";
import {
  BOMBER_CELLS,
  BOMBER_CONFIG,
  BOMBER_HEIGHT,
  BOMBER_MAX_PLAYERS,
  BOMBER_MAX_TICKS,
  BOMBER_MIN_PLAYERS,
  BOMBER_WIDTH,
  CELL_COLLAPSED,
  CELL_EMPTY,
  CELL_PILLAR,
  CELL_WALL,
  collapsedRings,
  isPillar,
  ringOf,
} from "../constants";
import type {
  BomberBomb,
  BomberDeath,
  BomberDeathCause,
  BomberPlayer,
  BomberPosition,
  BomberPowerup,
  BomberPowerupKind,
  BomberState,
} from "../sdk";
import { readArray, readId, readInteger, readRecord } from "./validation";

export const DEATH_CAUSES: readonly BomberDeathCause[] = ["flame", "collapse"];
export const POWERUP_KINDS: readonly BomberPowerupKind[] = ["fire", "bomb"];
/** Walls on the map plus ten points per bomb of every other player, the most a score can reach. */
export const MAX_SCORE = BOMBER_CELLS + 10 * BOMBER_CONFIG.maxBombs * (BOMBER_MAX_PLAYERS - 1);
/** The four corners in slot order before the seeded shuffle. */
const CORNERS: readonly BomberPosition[] = [
  { x: 0, y: 0 },
  { x: BOMBER_WIDTH - 1, y: 0 },
  { x: 0, y: BOMBER_HEIGHT - 1 },
  { x: BOMBER_WIDTH - 1, y: BOMBER_HEIGHT - 1 },
];

export const cellIndex = (position: BomberPosition): number =>
  position.y * BOMBER_WIDTH + position.x;
export const cellPosition = (index: number): BomberPosition => ({
  x: index % BOMBER_WIDTH,
  y: Math.floor(index / BOMBER_WIDTH),
});

/** A corner and the two cells along each edge next to it never start with a soft wall. */
export function spawnProtected(x: number, y: number): boolean {
  const mx = Math.min(x, BOMBER_WIDTH - 1 - x);
  const my = Math.min(y, BOMBER_HEIGHT - 1 - y);
  return (mx <= 2 && my === 0) || (mx === 0 && my <= 2);
}

/** Frozen cell grids that passed validation, with the collapsed ring count they were checked for. */
const validCells = new WeakMap<object, number>();

/**
 * Validate the cell grid: pillars at odd coordinates, collapsed rings matching the tick, nothing
 * else outside 0–3. With `share`, an engine snapshot grid is returned as is (read-only).
 */
export function readCells(raw: unknown, tick: number, share: boolean): number[] {
  const rings = collapsedRings(tick);
  const known = Array.isArray(raw) && raw.length === BOMBER_CELLS ? validCells.get(raw) : undefined;
  if (known !== rings) {
    const cells = readArray(raw, BOMBER_CELLS, "cells");
    for (let index = 0; index < BOMBER_CELLS; index++) {
      const value = readInteger(cells[index], CELL_EMPTY, CELL_COLLAPSED, "cell");
      const x = index % BOMBER_WIDTH;
      const y = Math.floor(index / BOMBER_WIDTH);
      if ((value === CELL_COLLAPSED) !== ringOf(x, y) < rings)
        throw new TypeError("Collapsed cells must match the rings the tick has removed");
      if (value !== CELL_COLLAPSED && (value === CELL_PILLAR) !== isPillar(x, y))
        throw new TypeError("Pillars stand exactly on odd coordinates");
    }
    if (Object.isFrozen(raw)) validCells.set(raw as object, rings);
  }
  if (isJsonSnapshot(raw)) return share ? (raw as number[]) : Array.from(raw as number[]);
  return (raw as number[]).map((cell) => (cell === 0 ? 0 : cell));
}

/** Frozen hidden grids that passed validation, with the cell grid they were checked against. */
const validHidden = new WeakMap<object, readonly number[]>();

export function readHidden(raw: unknown, cells: readonly number[], share: boolean): number[] {
  const known =
    Array.isArray(raw) && raw.length === BOMBER_CELLS ? validHidden.get(raw) : undefined;
  if (known !== cells) {
    const hidden = readArray(raw, BOMBER_CELLS, "hidden");
    for (let index = 0; index < BOMBER_CELLS; index++) {
      const value = readInteger(hidden[index], 0, POWERUP_KINDS.length, "hidden item");
      if (value !== 0 && cells[index] !== CELL_WALL)
        throw new TypeError("Hidden items exist only under soft walls");
    }
    if (Object.isFrozen(raw)) validHidden.set(raw as object, cells);
  }
  if (isJsonSnapshot(raw)) return share ? (raw as number[]) : Array.from(raw as number[]);
  return (raw as number[]).map((cell) => (cell === 0 ? 0 : cell));
}

export function readPosition(raw: unknown, label: string): BomberPosition {
  const point = readRecord(raw, ["x", "y"], label);
  return {
    x: readInteger(point.x, 0, BOMBER_WIDTH - 1, `${label}.x`),
    y: readInteger(point.y, 0, BOMBER_HEIGHT - 1, `${label}.y`),
  };
}

export function readCauses(raw: unknown): BomberDeathCause[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > DEATH_CAUSES.length)
    throw new TypeError("Invalid death causes");
  let previous = -1;
  return readArray(raw, raw.length, "causes").map((cause) => {
    const order = DEATH_CAUSES.indexOf(cause as BomberDeathCause);
    if (order <= previous) throw new TypeError("Death causes must be known, unique and ordered");
    previous = order;
    return cause as BomberDeathCause;
  });
}

export function readKind(raw: unknown): BomberPowerupKind {
  if (!POWERUP_KINDS.includes(raw as BomberPowerupKind))
    throw new TypeError("Powerup kind must be fire or bomb");
  return raw as BomberPowerupKind;
}

export function readPlayerCount(raw: unknown, label: string): number {
  if (!Array.isArray(raw) || raw.length < BOMBER_MIN_PLAYERS || raw.length > BOMBER_MAX_PLAYERS)
    throw new TypeError(`${label} must list ${BOMBER_MIN_PLAYERS}–${BOMBER_MAX_PLAYERS} players`);
  return raw.length;
}

/**
 * Bombs in placement order on distinct empty cells, each owned by a known slot and within the
 * owner's limit when it is known. Returns the bombs and how many each slot owns.
 */
export function readBombs(
  raw: unknown,
  cells: readonly number[],
  count: number,
  bombsMax: ReadonlyArray<number | undefined>,
): { bombs: BomberBomb[]; perOwner: number[] } {
  if (!Array.isArray(raw) || raw.length > BOMBER_CONFIG.maxBombs * count)
    throw new TypeError("Invalid bombs");
  const taken = new Set<number>();
  const perOwner = Array<number>(count).fill(0);
  const bombs = readArray(raw, raw.length, "bombs").map((rawBomb): BomberBomb => {
    const bomb = readRecord(rawBomb, ["position", "owner", "fuse", "range"], "bomb");
    const position = readPosition(bomb.position, "bomb.position");
    const index = cellIndex(position);
    if (cells[index] !== CELL_EMPTY || taken.has(index))
      throw new TypeError("Bombs lie alone on empty cells");
    taken.add(index);
    const owner = readInteger(bomb.owner, 0, count - 1, "bomb.owner");
    perOwner[owner]!++;
    const limit = bombsMax[owner];
    if (limit !== undefined && perOwner[owner]! > limit)
      throw new TypeError("A player cannot exceed its bomb limit");
    return {
      position,
      owner,
      fuse: readInteger(bomb.fuse, 1, BOMBER_CONFIG.bombFuse - 1, "bomb.fuse"),
      range: readInteger(bomb.range, BOMBER_CONFIG.initialRange, BOMBER_CONFIG.maxRange, "range"),
    };
  });
  return { bombs, perOwner };
}

/** Powerups on distinct empty cells that hold no bomb. */
export function readPowerups(
  raw: unknown,
  cells: readonly number[],
  bombs: readonly BomberBomb[],
): BomberPowerup[] {
  if (!Array.isArray(raw) || raw.length > BOMBER_CELLS) throw new TypeError("Invalid powerups");
  const taken = new Set(bombs.map((bomb) => cellIndex(bomb.position)));
  return readArray(raw, raw.length, "powerups").map((rawItem): BomberPowerup => {
    const item = readRecord(rawItem, ["position", "kind"], "powerup");
    const position = readPosition(item.position, "powerup.position");
    const index = cellIndex(position);
    if (cells[index] !== CELL_EMPTY || taken.has(index))
      throw new TypeError("Powerups lie alone on empty cells without bombs");
    taken.add(index);
    return { position, kind: readKind(item.kind) };
  });
}

export function parseBomberState(raw: unknown): BomberState {
  return readBomberState(raw, false);
}

/** parseBomberState for read-only use: engine snapshot grids are shared, not copied. */
const validatedStates = new WeakMap<object, DeepReadonly<BomberState>>();

export function viewBomberState(raw: unknown): DeepReadonly<BomberState> {
  const known = raw !== null && typeof raw === "object" && isJsonSnapshot(raw);
  if (known) {
    const cached = validatedStates.get(raw as object);
    if (cached) return cached;
  }

  const result = readBomberState(raw, true);

  if (known) {
    const frozen = raw as DeepReadonly<BomberState>;
    validatedStates.set(raw as object, frozen);
    return frozen;
  }
  return result;
}

function readBomberState(raw: unknown, share: boolean): BomberState {
  const value = readRecord(
    raw,
    [
      "tick",
      "width",
      "height",
      "maxTicks",
      "cells",
      "hidden",
      "bombs",
      "powerups",
      "players",
      "rngState",
    ],
    "Bomber state",
  );
  if (
    value.width !== BOMBER_WIDTH ||
    value.height !== BOMBER_HEIGHT ||
    value.maxTicks !== BOMBER_MAX_TICKS
  )
    throw new TypeError("Bomber state must use the published map size and tick limit");
  const tick = readInteger(value.tick, 0, BOMBER_MAX_TICKS, "tick");
  const count = readPlayerCount(value.players, "Bomber state");
  const cells = readCells(value.cells, tick, share);
  const hidden = readHidden(value.hidden, cells, share);
  const ids = new Set<string>();
  const players = readArray(value.players, count, "players").map((rawPlayer, slot) => {
    const player = readRecord(
      rawPlayer,
      ["id", "slot", "position", "bombsMax", "fireRange", "score", "death"],
      "player",
    );
    if (player.slot !== slot) throw new TypeError("Bomber players are listed by slot");
    let death: BomberDeath | null = null;
    if (player.death !== null) {
      const entry = readRecord(player.death, ["tick", "causes"], "death");
      death = {
        tick: readInteger(entry.tick, 1, tick, "death.tick"),
        causes: readCauses(entry.causes),
      };
    }
    const position = death ? null : readPosition(player.position, "position");
    if (death && player.position !== null) throw new TypeError("An eliminated player is removed");
    if (position && cells[cellIndex(position)] !== CELL_EMPTY)
      throw new TypeError("A living player stands on an empty cell");
    const id = readId(player.id);
    if (ids.has(id)) throw new TypeError("Bomber IDs must be distinct");
    ids.add(id);
    return {
      id,
      slot,
      position,
      bombsMax: readInteger(
        player.bombsMax,
        BOMBER_CONFIG.initialBombs,
        BOMBER_CONFIG.maxBombs,
        "bombsMax",
      ),
      fireRange: readInteger(
        player.fireRange,
        BOMBER_CONFIG.initialRange,
        BOMBER_CONFIG.maxRange,
        "fireRange",
      ),
      score: readInteger(player.score, 0, death ? 0 : MAX_SCORE, "score"),
      death,
    } satisfies BomberPlayer;
  });
  const { bombs } = readBombs(
    value.bombs,
    cells,
    count,
    players.map((player) => player.bombsMax),
  );
  const powerups = readPowerups(value.powerups, cells, bombs);
  const items = new Set(powerups.map((item) => cellIndex(item.position)));
  for (const player of players)
    if (player.position && items.has(cellIndex(player.position)))
      throw new TypeError("A living player has picked up the powerup under it");
  return {
    tick,
    width: BOMBER_WIDTH,
    height: BOMBER_HEIGHT,
    maxTicks: BOMBER_MAX_TICKS,
    cells,
    hidden,
    bombs,
    powerups,
    players,
    rngState: readInteger(value.rngState, 1, 0xffffffff, "rngState"),
  };
}

export function initBomber(input: InitInput): BomberState {
  const config = readRecord(input.config, Object.keys(BOMBER_CONFIG), "Bomber config");
  for (const [key, expected] of Object.entries(BOMBER_CONFIG))
    if (config[key] !== expected) throw new TypeError(`Unsupported Bomber config: ${key}`);
  const count = readPlayerCount(input.players, "Bomber init");
  const seats: { id: string; slot: number }[] = [];
  for (const rawPlayer of readArray(input.players, count, "players")) {
    const player = readRecord(rawPlayer, ["id", "slot"], "initial player");
    const slot = readInteger(player.slot, 0, count - 1, "slot");
    const id = readId(player.id);
    if (seats[slot] || seats.some((seat) => seat?.id === id))
      throw new TypeError("Bomber requires distinct IDs and slots 0..n-1");
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
  // (such as consecutive local runs) produce well-mixed maps.
  for (let warmUp = 0; warmUp < 4; warmUp++) next();
  // Fisher–Yates over all four corners: the seed decides which seat starts where.
  const spawns = CORNERS.map((corner) => ({ ...corner }));
  for (let index = spawns.length - 1; index > 0; index--) {
    const other = next() % (index + 1);
    [spawns[index], spawns[other]] = [spawns[other]!, spawns[index]!];
  }
  const cells = Array<number>(BOMBER_CELLS).fill(CELL_EMPTY);
  const hidden = Array<number>(BOMBER_CELLS).fill(0);
  for (let index = 0; index < BOMBER_CELLS; index++)
    if (isPillar(index % BOMBER_WIDTH, Math.floor(index / BOMBER_WIDTH)))
      cells[index] = CELL_PILLAR;
  // The top-left quadrant is drawn in index order and mirrored four ways, so every corner is fair.
  for (let y = 0; y <= (BOMBER_HEIGHT - 1) / 2; y++) {
    for (let x = 0; x <= (BOMBER_WIDTH - 1) / 2; x++) {
      if (isPillar(x, y) || spawnProtected(x, y)) continue;
      if (next() % 100 >= BOMBER_CONFIG.wallPercent) continue;
      const roll = next() % 100;
      const item = roll < 20 ? 1 : roll < 40 ? 2 : 0;
      for (const mx of new Set([x, BOMBER_WIDTH - 1 - x]))
        for (const my of new Set([y, BOMBER_HEIGHT - 1 - y])) {
          cells[my * BOMBER_WIDTH + mx] = CELL_WALL;
          hidden[my * BOMBER_WIDTH + mx] = item;
        }
    }
  }
  return {
    tick: 0,
    width: BOMBER_WIDTH,
    height: BOMBER_HEIGHT,
    maxTicks: BOMBER_MAX_TICKS,
    cells,
    hidden,
    bombs: [],
    powerups: [],
    players: seats.map(({ id, slot }) => ({
      id,
      slot,
      position: { ...spawns[slot]! },
      bombsMax: BOMBER_CONFIG.initialBombs,
      fireRange: BOMBER_CONFIG.initialRange,
      score: 0,
      death: null,
    })),
    rngState,
  };
}
