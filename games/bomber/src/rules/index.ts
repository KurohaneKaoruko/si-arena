import {
  isJsonSnapshot,
  type DeepReadonly,
  type GameResult,
  type GameRules,
} from "@si-arena/protocol";
import {
  BOMBER_CELLS,
  BOMBER_COLLAPSE_RINGS,
  BOMBER_CONFIG,
  BOMBER_HEIGHT,
  BOMBER_WIDTH,
  CELL_COLLAPSED,
  CELL_EMPTY,
  CELL_PILLAR,
  CELL_WALL,
  ringOf,
} from "../constants";
import type {
  BomberAction,
  BomberBomb,
  BomberDeathCause,
  BomberEvent,
  BomberObservation,
  BomberState,
} from "../sdk";
import { parseBomberAction } from "./actions";
import { bomberFinished, observeBomber } from "./observation";
import {
  DEATH_CAUSES,
  POWERUP_KINDS,
  cellIndex,
  cellPosition,
  initBomber,
  parseBomberState,
} from "./state";
import { readRecord } from "./validation";

export { parseBomberAction } from "./actions";
export { parseBomberState } from "./state";
export { parseBomberObservation, bomberCollapse } from "./observation";
export type { BomberDeathCause, BomberEvent } from "../sdk";

export interface BomberResult extends GameResult {
  /** `elimination` once at most one player is alive, otherwise `tick-limit`. */
  reason: "elimination" | "tick-limit";
  players: Array<{ id: string; rank: number; score: number; alive: boolean }>;
}
export interface BomberStepResult {
  nextState: BomberState;
  events: BomberEvent[];
  result?: BomberResult;
}
export interface BomberRules extends GameRules<
  BomberState,
  BomberObservation,
  BomberAction,
  BomberEvent
> {
  step(
    state: DeepReadonly<BomberState>,
    actions: DeepReadonly<Record<string, BomberAction>>,
  ): BomberStepResult;
}

const DELTAS = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] } as const;

/** Whether a ranking key [alive, score or death tick] places its player strictly ahead. */
const ahead = (first: number[], second: number[]) =>
  first[0]! > second[0]! || (first[0] === second[0] && first[1]! > second[1]!);

/**
 * Living players rank first by score, the eliminated after them by death tick, later first.
 * Equal keys share a rank, and each rank is one more than the number of players ahead.
 */
function outcome(state: BomberState): BomberResult | undefined {
  if (!bomberFinished(state)) return undefined;
  const key = (slot: number) => {
    const player = state.players[slot]!;
    return player.death ? [0, player.death.tick] : [1, player.score];
  };
  const keys = state.players.map((player) => key(player.slot));
  return {
    reason:
      state.players.filter((player) => !player.death).length <= 1 ? "elimination" : "tick-limit",
    completedTicks: state.tick,
    players: state.players.map((player) => ({
      id: player.id,
      rank: 1 + keys.filter((other) => ahead(other, keys[player.slot]!)).length,
      score: player.death ? 0 : player.score,
      alive: !player.death,
    })),
  };
}

/**
 * Cells a bomb's flames cover on the given map: its own cell and up to `range` cells per
 * direction, stopping before pillars, collapsed cells and the edge, and on a soft wall.
 */
export function flameCells(cells: readonly number[], bomb: DeepReadonly<BomberBomb>): number[] {
  const origin = cellIndex(bomb.position);
  const covered = [origin];
  for (const [dx, dy] of Object.values(DELTAS)) {
    for (let distance = 1; distance <= bomb.range; distance++) {
      const x = bomb.position.x + dx * distance;
      const y = bomb.position.y + dy * distance;
      if (x < 0 || y < 0 || x >= BOMBER_WIDTH || y >= BOMBER_HEIGHT) break;
      const index = y * BOMBER_WIDTH + x;
      const cell = cells[index]!;
      if (cell === CELL_PILLAR || cell === CELL_COLLAPSED) break;
      covered.push(index);
      if (cell === CELL_WALL) break;
    }
  }
  return covered;
}

function step(
  state: DeepReadonly<BomberState>,
  rawActions: DeepReadonly<Record<string, BomberAction>>,
): BomberStepResult {
  const next = parseBomberState(state);
  if (bomberFinished(next)) throw new TypeError("Cannot step a finished Bomber game");
  const { cells, hidden, players } = next;
  const alive = players.filter((player) => player.position !== null);
  const raw = readRecord(
    rawActions,
    alive.map((player) => player.id),
    "Bomber tick actions",
  );
  const actions = alive.map((player) => {
    const parsed = parseBomberAction(raw[player.id]);
    if (!parsed.ok) throw new TypeError(`Invalid action for ${player.id}: ${parsed.message}`);
    return parsed.action;
  });
  const causes = players.map(() => new Set<BomberDeathCause>());
  const killers = players.map(() => new Set<number>());
  const events: BomberEvent[] = [];
  const bombAt = new Map<number, number>();
  next.bombs.forEach((bomb, index) => bombAt.set(cellIndex(bomb.position), index));
  // 1. Movement against the world as it stood: walls, pillars, collapsed cells and bombs block;
  // players never block each other.
  alive.forEach((player, index) => {
    const action = actions[index]!;
    if (action.type !== "move") return;
    const x = player.position!.x + DELTAS[action.direction][0];
    const y = player.position!.y + DELTAS[action.direction][1];
    if (x < 0 || y < 0 || x >= BOMBER_WIDTH || y >= BOMBER_HEIGHT) return;
    const target = y * BOMBER_WIDTH + x;
    if (cells[target] !== CELL_EMPTY || bombAt.has(target)) return;
    const from = player.position!;
    player.position = { x, y };
    events.push({ type: "move", playerId: player.id, from, to: { x, y } });
  });
  // 2. Bombs drop under their placer, one per cell, within the placer's limit; lower slots first.
  const owned = players.map(() => 0);
  for (const bomb of next.bombs) owned[bomb.owner]!++;
  alive.forEach((player, index) => {
    if (actions[index]!.type !== "bomb") return;
    const here = cellIndex(player.position!);
    if (bombAt.has(here) || owned[player.slot]! >= player.bombsMax) return;
    bombAt.set(here, next.bombs.length);
    owned[player.slot]!++;
    next.bombs.push({
      position: { ...player.position! },
      owner: player.slot,
      fuse: BOMBER_CONFIG.bombFuse,
      range: player.fireRange,
    });
    events.push({ type: "bomb-placed", playerId: player.id, position: { ...player.position! } });
  });
  // 3. Fuses burn down; flames reaching another bomb set it off in the same tick.
  const flames = next.bombs.map((bomb) => flameCells(cells, bomb));
  for (const bomb of next.bombs) bomb.fuse -= 1;
  const exploding = next.bombs.map((bomb) => bomb.fuse === 0);
  for (let changed = true; changed;) {
    changed = false;
    exploding.forEach((isExploding, index) => {
      if (!isExploding) return;
      for (const cell of flames[index]!) {
        const other = bombAt.get(cell);
        if (other !== undefined && !exploding[other]) {
          exploding[other] = true;
          changed = true;
        }
      }
    });
  }
  const burning = new Uint8Array(BOMBER_CELLS);
  const creditedTo = new Map<number, number>();
  const exploded: number[] = [];
  exploding.forEach((isExploding, index) => {
    if (!isExploding) return;
    exploded.push(index);
    for (const cell of flames[index]!) {
      burning[cell] = 1;
      // The first bomb by placement whose ray reaches a wall gets the credit for it.
      if (cells[cell] === CELL_WALL && !creditedTo.has(cell))
        creditedTo.set(cell, next.bombs[index]!.owner);
    }
  });
  const living = (slot: number) => !players[slot]!.death;
  if (exploded.length) {
    // 4. Walls fall and reveal their items; items already on the ground burn away.
    const destroyed = [...creditedTo.keys()].toSorted((a, b) => a - b);
    next.powerups = next.powerups.filter((item) => !burning[cellIndex(item.position)]);
    for (const cell of destroyed) {
      cells[cell] = CELL_EMPTY;
      if (hidden[cell]) {
        next.powerups.push({
          position: cellPosition(cell),
          kind: POWERUP_KINDS[hidden[cell]! - 1]!,
        });
        hidden[cell] = 0;
      }
      const owner = creditedTo.get(cell)!;
      if (living(owner)) players[owner]!.score += 1;
    }
    const burningCells: number[] = [];
    for (let cell = 0; cell < BOMBER_CELLS; cell++) if (burning[cell]) burningCells.push(cell);
    events.push({
      type: "explosion",
      bombs: exploded.map((index) => ({
        position: { ...next.bombs[index]!.position },
        ownerId: players[next.bombs[index]!.owner]!.id,
      })),
      cells: burningCells,
      destroyed,
    });
    // 5. Flames kill whoever stands in them after moving; each covering bomb's living owner
    // earns ten points, never for themselves.
    for (const player of alive) {
      const here = cellIndex(player.position!);
      if (!burning[here]) continue;
      causes[player.slot]!.add("flame");
      for (const index of exploded) {
        if (!flames[index]!.includes(here)) continue;
        const owner = next.bombs[index]!.owner;
        if (owner === player.slot) continue;
        killers[player.slot]!.add(owner);
        if (living(owner)) players[owner]!.score += 10;
      }
    }
    next.bombs = next.bombs.filter((_, index) => !exploding[index]);
  }
  // 6. Everyone still standing picks up what lies under them.
  const taken = new Set<number>();
  for (const player of alive) {
    if (causes[player.slot]!.has("flame")) continue;
    const here = cellIndex(player.position!);
    const item = next.powerups.find((candidate) => cellIndex(candidate.position) === here);
    if (!item) continue;
    taken.add(here);
    if (item.kind === "fire")
      player.fireRange = Math.min(BOMBER_CONFIG.maxRange, player.fireRange + 1);
    else player.bombsMax = Math.min(BOMBER_CONFIG.maxBombs, player.bombsMax + 1);
    events.push({
      type: "pickup",
      playerId: player.id,
      kind: item.kind,
      position: { ...item.position },
    });
  }
  next.powerups = next.powerups.filter((item) => !taken.has(cellIndex(item.position)));
  // 7. From tick 300 on, every eighth settlement removes the next ring with all it holds.
  const tick = next.tick + 1;
  const ring = (tick - BOMBER_CONFIG.collapseStart) / BOMBER_CONFIG.collapseInterval;
  if (Number.isInteger(ring) && ring >= 0 && ring < BOMBER_COLLAPSE_RINGS) {
    const fallen = new Uint8Array(BOMBER_CELLS);
    const collapsed: number[] = [];
    for (let cell = 0; cell < BOMBER_CELLS; cell++) {
      if (ringOf(cell % BOMBER_WIDTH, Math.floor(cell / BOMBER_WIDTH)) !== ring) continue;
      fallen[cell] = 1;
      collapsed.push(cell);
      cells[cell] = CELL_COLLAPSED;
      hidden[cell] = 0;
    }
    next.bombs = next.bombs.filter((bomb) => !fallen[cellIndex(bomb.position)]);
    next.powerups = next.powerups.filter((item) => !fallen[cellIndex(item.position)]);
    for (const player of alive)
      if (fallen[cellIndex(player.position!)]) causes[player.slot]!.add("collapse");
    events.push({ type: "collapse", ring, cells: collapsed });
  }
  // 8. The dead leave the map with their cause of death; their bombs stay.
  for (const player of alive) {
    if (!causes[player.slot]!.size) continue;
    const list = DEATH_CAUSES.filter((cause) => causes[player.slot]!.has(cause));
    events.push({
      type: "death",
      playerId: player.id,
      position: player.position!,
      causes: list,
      killerIds: [...killers[player.slot]!]
        .toSorted((a, b) => a - b)
        .map((slot) => players[slot]!.id),
    });
    player.position = null;
    player.death = { tick, causes: [...list] };
    player.score = 0;
  }
  next.tick = tick;
  // Reuse only already validated immutable inputs, after all writes are complete.
  // Following ticks clone before writing; old worlds and replay caches stay unchanged.
  for (const key of ["cells", "hidden"] as const) {
    const previous = state[key];
    if (isJsonSnapshot(previous) && next[key].every((cell, index) => cell === previous[index]))
      next[key] = previous as number[];
  }
  const result = outcome(next);
  return result ? { nextState: next, events, result } : { nextState: next, events };
}

export const bomberRules: BomberRules = {
  init: initBomber,
  observe: observeBomber,
  parseAction: parseBomberAction,
  defaultAction(state, playerId) {
    if (!state.players.some((player) => player.id === playerId))
      throw new TypeError("Unknown Bomber player");
    return { type: "idle" };
  },
  step,
};
