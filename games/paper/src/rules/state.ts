import type { DeepReadonly, InitInput } from "@si-arena/protocol";
import { PAPER_CONFIG, PAPER_MAX_TICKS } from "../constants";
import type { PaperPlayer, PaperState } from "../sdk";
import { readArray, readId, readInteger, readRecord } from "./validation";

const CELL_COUNT = PAPER_CONFIG.width * PAPER_CONFIG.height;

function readGrid(grid: unknown, label: string): number[] {
  return readArray(grid, CELL_COUNT, label).map((cell) => readInteger(cell, -1, 1, label));
}

export function parsePaperState(raw: unknown): PaperState {
  const value = readRecord(
    raw,
    ["tick", "width", "height", "maxTicks", "territory", "trails", "players", "spawns", "rngState"],
    "Paper state",
  );
  if (
    value.width !== PAPER_CONFIG.width ||
    value.height !== PAPER_CONFIG.height ||
    value.maxTicks !== PAPER_MAX_TICKS
  ) {
    throw new TypeError("Paper state must use the published map dimensions and tick limit");
  }
  const players = readArray(value.players, 2, "players").map((rawPlayer, slot): PaperPlayer => {
    const player = readRecord(rawPlayer, ["id", "slot", "alive", "position"], "player");
    if (player.slot !== slot || player.alive !== true) {
      throw new TypeError("Paper players keep their seat and stay in the match");
    }
    const point = readRecord(player.position, ["x", "y"], "position");
    return {
      id: readId(player.id),
      slot: slot === 0 ? 0 : 1,
      alive: true,
      position: {
        x: readInteger(point.x, 0, PAPER_CONFIG.width - 1, "position.x"),
        y: readInteger(point.y, 0, PAPER_CONFIG.height - 1, "position.y"),
      },
    };
  });
  const first = players[0];
  const second = players[1];
  if (!first || !second || first.id === second.id)
    throw new TypeError("Paper requires two distinct player IDs");
  if (
    first.position &&
    second.position &&
    first.position.x === second.position.x &&
    first.position.y === second.position.y
  ) {
    throw new TypeError("Living heads cannot share a cell");
  }
  const spawns = readArray(value.spawns, 2, "spawns").map((rawSpawn) => {
    const point = readRecord(rawSpawn, ["x", "y"], "spawn");
    return {
      x: readInteger(point.x, 0, PAPER_CONFIG.width - 1, "spawn.x"),
      y: readInteger(point.y, 0, PAPER_CONFIG.height - 1, "spawn.y"),
    };
  }) as [{ x: number; y: number }, { x: number; y: number }];
  if (spawns[0].x === spawns[1].x && spawns[0].y === spawns[1].y) {
    throw new TypeError("Paper spawn points must differ");
  }
  const state: PaperState = {
    tick: readInteger(value.tick, 0, PAPER_MAX_TICKS, "tick"),
    width: PAPER_CONFIG.width,
    height: PAPER_CONFIG.height,
    maxTicks: PAPER_MAX_TICKS,
    territory: readGrid(value.territory, "territory"),
    trails: readGrid(value.trails, "trails"),
    players: [first, second],
    spawns,
    rngState: readInteger(value.rngState, 1, 0xffffffff, "rngState"),
  };
  for (const player of state.players) {
    const hasTrail = state.trails.includes(player.slot);
    if (!player.position) throw new TypeError("A player in the match keeps its head position");
    const index = player.position.y * state.width + player.position.x;
    if (state.territory[index] === player.slot) {
      if (hasTrail) throw new TypeError("A head inside its territory cannot retain a trail");
    } else if (state.trails[index] !== player.slot) {
      throw new TypeError("A head outside its territory must be on its own trail");
    }
  }
  return state;
}

export function initPaper(input: InitInput): PaperState {
  const config = readRecord(
    input.config,
    ["width", "height", "initialTerritorySize"],
    "Paper config",
  );
  for (const key of ["width", "height", "initialTerritorySize"] as const) {
    if (config[key] !== PAPER_CONFIG[key]) throw new TypeError(`Unsupported Paper config: ${key}`);
  }
  const players = readArray(input.players, 2, "players").map((rawPlayer) => {
    const player = readRecord(rawPlayer, ["id", "slot"], "initial player");
    return { id: readId(player.id), slot: readInteger(player.slot, 0, 1, "slot") };
  });
  const first = players.find((player) => player.slot === 0);
  const second = players.find((player) => player.slot === 1);
  if (!first || !second || first.id === second.id)
    throw new TypeError("Paper requires distinct IDs and slots 0 and 1");
  let rngState = readInteger(input.seed, 0, 0xffffffff, "seed") || 0x9e3779b9;
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  rngState >>>= 0;
  const swap = (rngState & 1) === 1;
  const createPlayer = (id: string, slot: 0 | 1): PaperPlayer => ({
    id,
    slot,
    alive: true,
    position: { x: (slot === 0) !== swap ? 5 : 34, y: 14 },
  });
  const seats = [createPlayer(first.id, 0), createPlayer(second.id, 1)];
  const spawns = seats.map((player) => {
    if (!player.position) throw new Error("Initial position is missing");
    return { ...player.position };
  }) as [{ x: number; y: number }, { x: number; y: number }];
  const state: PaperState = {
    tick: 0,
    width: PAPER_CONFIG.width,
    height: PAPER_CONFIG.height,
    maxTicks: PAPER_MAX_TICKS,
    territory: Array<number>(CELL_COUNT).fill(-1),
    trails: Array<number>(CELL_COUNT).fill(-1),
    players: [seats[0]!, seats[1]!],
    spawns,
    rngState,
  };
  for (const player of state.players) {
    const spawn = spawns[player.slot];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        state.territory[(spawn.y + dy) * state.width + spawn.x + dx] = player.slot;
      }
    }
  }
  return state;
}

export function paperScores(state: DeepReadonly<PaperState>): [number, number] {
  const scores: [number, number] = [0, 0];
  for (const owner of state.territory) if (owner === 0 || owner === 1) scores[owner]++;
  return scores;
}
