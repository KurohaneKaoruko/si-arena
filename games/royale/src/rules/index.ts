import type { DeepReadonly, GameResult, GameRules } from "@si-arena/protocol";
import { ROYALE_CONFIG, royaleZoneTarget } from "../constants";
import type {
  RoyaleAction,
  RoyaleDeathCause,
  RoyaleEvent,
  RoyaleObservation,
  RoyaleState,
} from "../sdk";
import { parseRoyaleAction } from "./actions";
import { enclosedCells } from "./capture";
import { observeRoyale, royaleFinished } from "./observation";
import { DEATH_CAUSES, initRoyale, insideZone, parseRoyaleState, royaleAreas } from "./state";
import { readRecord } from "./validation";

export { parseRoyaleAction } from "./actions";
export { parseRoyaleState } from "./state";
export { parseRoyaleObservation } from "./observation";
export type { RoyaleDeathCause, RoyaleEvent } from "../sdk";

export interface RoyaleResult extends GameResult {
  /** `elimination` once at most one player is alive, otherwise `tick-limit`. */
  reason: "elimination" | "tick-limit";
  players: Array<{ id: string; rank: number; score: number; alive: boolean }>;
}
export interface RoyaleStepResult {
  nextState: RoyaleState;
  events: RoyaleEvent[];
  result?: RoyaleResult;
}
export interface RoyaleRules extends GameRules<
  RoyaleState,
  RoyaleObservation,
  RoyaleAction,
  RoyaleEvent
> {
  step(
    state: DeepReadonly<RoyaleState>,
    actions: DeepReadonly<Record<string, RoyaleAction>>,
  ): RoyaleStepResult;
}

const DELTAS = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] } as const;

/** Whether a ranking key [alive, area or death tick] places its player strictly ahead. */
const ahead = (first: number[], second: number[]) =>
  first[0]! > second[0]! || (first[0] === second[0] && first[1]! > second[1]!);

/**
 * Living players rank first by area, the eliminated after them by death tick, later first.
 * Equal keys share a rank, and each rank is one more than the number of players ahead.
 */
function outcome(state: RoyaleState): RoyaleResult | undefined {
  if (!royaleFinished(state)) return undefined;
  const areas = royaleAreas(state.territory, state.players.length);
  const key = (slot: number) => {
    const death = state.players[slot]!.death;
    return death ? [0, death.tick] : [1, areas[slot]!];
  };
  const keys = state.players.map((player) => key(player.slot));
  return {
    reason:
      state.players.filter((player) => !player.death).length <= 1 ? "elimination" : "tick-limit",
    completedTicks: state.tick,
    players: state.players.map((player) => ({
      id: player.id,
      rank: 1 + keys.filter((other) => ahead(other, keys[player.slot]!)).length,
      score: areas[player.slot]!,
      alive: !player.death,
    })),
  };
}

function clearSlot(cells: number[], slot: number): void {
  for (let index = 0; index < cells.length; index++) if (cells[index] === slot) cells[index] = -1;
}

function step(
  state: DeepReadonly<RoyaleState>,
  rawActions: DeepReadonly<Record<string, RoyaleAction>>,
): RoyaleStepResult {
  const next = parseRoyaleState(state);
  if (royaleFinished(next)) throw new TypeError("Cannot step a finished Royale game");
  const { width, height, territory, trails, players } = next;
  const alive = players.filter((player) => player.position !== null);
  const raw = readRecord(
    rawActions,
    alive.map((player) => player.id),
    "Royale tick actions",
  );
  const actions = alive.map((player) => {
    const parsed = parseRoyaleAction(raw[player.id]);
    if (!parsed.ok) throw new TypeError(`Invalid action for ${player.id}: ${parsed.message}`);
    return parsed.action;
  });
  const origins = alive.map(({ position }) => position!.y * width + position!.x);
  const causes = players.map(() => new Set<RoyaleDeathCause>());
  const events: RoyaleEvent[] = [];
  // 1. Bounds: a target off the map kills; the dead head has no cell to collide on.
  const targets = alive.map((player, index) => {
    const action = actions[index]!;
    if (action.type === "idle") return origins[index]!;
    const x = player.position!.x + DELTAS[action.direction][0];
    const y = player.position!.y + DELTAS[action.direction][1];
    if (x >= 0 && y >= 0 && x < width && y < height) return y * width + x;
    causes[player.slot]!.add("boundary");
    return -1;
  });
  // 2. Heads: two targets on one cell kill all of them; two movers swapping cells kill both.
  alive.forEach((player, index) => {
    const target = targets[index]!;
    if (target < 0) return;
    alive.forEach((other, otherIndex) => {
      if (other === player) return;
      if (targets[otherIndex] === target) causes[player.slot]!.add("head-collision");
      if (
        actions[index]!.type === "move" &&
        actions[otherIndex]!.type === "move" &&
        target === origins[otherIndex] &&
        targets[otherIndex] === origins[index]
      )
        causes[player.slot]!.add("head-swap");
    });
  });
  // 3. Trails as they stood at the start of the tick: entering one kills its owner.
  const trailed = players.map((player) => trails.includes(player.slot));
  alive.forEach((player, index) => {
    const target = targets[index]!;
    const owner = target < 0 ? -1 : trails[target]!;
    if (owner < 0) return;
    if (owner === player.slot) {
      if (actions[index]!.type === "move") causes[owner]!.add("self-trail");
      return;
    }
    causes[owner]!.add("trail-cut");
    events.push({
      type: "trail-cut",
      playerId: players[owner]!.id,
      attackerId: player.id,
      position: { x: target % width, y: Math.floor(target / width) },
    });
  });
  const dying = (slot: number) => causes[slot]!.size > 0;
  // 4. Survivors move; a step off the own territory extends the trail.
  const closers: number[] = [];
  alive.forEach((player, index) => {
    if (dying(player.slot)) return;
    const target = targets[index]!;
    const from = player.position!;
    player.position = { x: target % width, y: Math.floor(target / width) };
    if (actions[index]!.type === "move")
      events.push({ type: "move", playerId: player.id, from, to: { ...player.position } });
    if (territory[target] !== player.slot) trails[target] = player.slot;
    else if (trailed[player.slot]) closers.push(player.slot);
  });
  // 5. Captures share one board. A closer claims what it encloses beyond its own territory.
  // A cell claimed by exactly one closer changes hands; a cell claimed by several stays as it
  // is. A foreign trail on any claimed cell dies, contested or not.
  const enclosed = closers.map((slot) => enclosedCells(width, height, territory, trails, slot));
  const gained = closers.map((): number[] => []);
  for (let cell = 0; cell < territory.length; cell++) {
    let claimer = -1;
    let claims = 0;
    closers.forEach((slot, index) => {
      if (!enclosed[index]![cell] || territory[cell] === slot) return;
      const trail = trails[cell]!;
      if (trail >= 0 && trail !== slot) causes[trail]!.add("enclosed");
      claimer = index;
      claims++;
    });
    if (claims !== 1) continue;
    gained[claimer]!.push(cell);
    territory[cell] = closers[claimer]!;
  }
  closers.forEach((slot, index) =>
    events.push({ type: "capture", playerId: players[slot]!.id, cells: gained[index]! }),
  );
  // A closer's trail is spent. A head left off its own land without a trail starts a new one
  // where it stands, so a player whose land was captured underneath stays exposed.
  for (const player of alive) {
    if (dying(player.slot)) continue;
    const head = player.position!.y * width + player.position!.x;
    if (closers.includes(player.slot) || territory[head] === player.slot)
      clearSlot(trails, player.slot);
    if (territory[head] !== player.slot && !trails.includes(player.slot))
      trails[head] = player.slot;
  }
  // 6. Safe zone: on every interval tick above target it loses a ring that becomes neutral.
  const tick = next.tick + 1;
  if (tick % ROYALE_CONFIG.shrinkInterval === 0 && next.zoneSize > royaleZoneTarget(alive.length)) {
    next.zoneSize -= 2;
    for (let cell = 0; cell < territory.length; cell++) {
      if (insideZone(width, next.zoneSize, cell % width, Math.floor(cell / width))) continue;
      territory[cell] = -1;
      trails[cell] = -1;
    }
    events.push({ type: "zone-shrink", size: next.zoneSize });
  }
  for (const player of alive)
    if (
      !dying(player.slot) &&
      !insideZone(width, next.zoneSize, player.position!.x, player.position!.y)
    )
      causes[player.slot]!.add("zone");
  // 7. The dead lose their land and trails and leave the map.
  for (const player of alive) {
    if (!dying(player.slot)) continue;
    clearSlot(territory, player.slot);
    clearSlot(trails, player.slot);
    const list = DEATH_CAUSES.filter((cause) => causes[player.slot]!.has(cause));
    events.push({ type: "death", playerId: player.id, position: player.position!, causes: list });
    player.position = null;
    player.death = { tick, causes: [...list] };
  }
  next.tick = tick;
  const result = outcome(next);
  return result ? { nextState: next, events, result } : { nextState: next, events };
}

export const royaleRules: RoyaleRules = {
  init: initRoyale,
  observe: observeRoyale,
  parseAction: parseRoyaleAction,
  defaultAction(state, playerId) {
    if (!state.players.some((player) => player.id === playerId))
      throw new TypeError("Unknown Royale player");
    return { type: "idle" };
  },
  step,
};
