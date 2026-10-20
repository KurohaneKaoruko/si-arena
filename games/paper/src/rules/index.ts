import type { DeepReadonly, GameResult, GameRules } from "@si-arena/protocol";
import type { PaperAction, PaperObservation, PaperPlayer, PaperState } from "../sdk";
import { parsePaperAction } from "./actions";
import { captureCells } from "./capture";
import { initPaper, paperScores, parsePaperState } from "./state";
import { readRecord } from "./validation";

export { parsePaperAction } from "./actions";
export { parsePaperState } from "./state";

type Position = { x: number; y: number };
const RESET_CAUSES = [
  "boundary",
  "head-collision",
  "head-swap",
  "self-trail",
  "trail-cut",
] as const;
export type PaperResetCause = (typeof RESET_CAUSES)[number];
export type PaperEvent =
  | { type: "move"; playerId: string; from: Position; to: Position }
  | { type: "trail-cut"; playerId: string; attackerId: string; position: Position }
  | { type: "capture"; playerId: string; cells: number[] }
  | { type: "reset"; playerId: string; from: Position; to: Position; causes: PaperResetCause[] };

export interface PaperResult extends GameResult {
  reason: "tick-limit";
  players: Array<{ id: string; rank: number; score: number; alive: boolean }>;
}
export interface PaperStepResult {
  nextState: PaperState;
  events: PaperEvent[];
  result?: PaperResult;
}
export interface PaperRules extends GameRules<
  PaperState,
  PaperObservation,
  PaperAction,
  PaperEvent
> {
  step(
    state: DeepReadonly<PaperState>,
    actions: DeepReadonly<Record<string, PaperAction>>,
  ): PaperStepResult;
}

function positionOf(player: DeepReadonly<PaperPlayer>): Position {
  if (!player.position) throw new TypeError("A living player must have a position");
  return { ...player.position };
}
function samePosition(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y;
}
function targetPosition(from: Position, action: PaperAction): Position {
  if (action.type === "idle") return { ...from };
  const delta = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] } as const;
  const [dx, dy] = delta[action.direction];
  return { x: from.x + dx, y: from.y + dy };
}
function terminal(state: DeepReadonly<PaperState>): boolean {
  return state.tick >= state.maxTicks;
}
function findPlayer(state: DeepReadonly<PaperState>, playerId: string) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) throw new TypeError("Unknown Paper player");
  return player;
}
function outcome(state: PaperState): PaperResult | undefined {
  if (!terminal(state)) return undefined;
  const scores = paperScores(state);
  const winner: 0 | 1 | null = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
  return {
    reason: "tick-limit",
    completedTicks: state.tick,
    players: state.players.map((player) => ({
      id: player.id,
      rank: winner === null || winner === player.slot ? 1 : 2,
      score: scores[player.slot],
      alive: player.alive,
    })),
  };
}
/** Remove every trail cell of one slot; the territory of that slot is untouched. */
function clearTrail(state: PaperState, slot: 0 | 1): void {
  for (let cell = 0; cell < state.trails.length; cell++) {
    if (state.trails[cell] === slot) state.trails[cell] = -1;
  }
}

function step(
  state: DeepReadonly<PaperState>,
  rawActions: DeepReadonly<Record<string, PaperAction>>,
): PaperStepResult {
  const nextState = parsePaperState(state);
  if (terminal(nextState)) throw new TypeError("Cannot step a finished Paper game");
  const raw = readRecord(
    rawActions,
    nextState.players.map((player) => player.id),
    "Paper tick actions",
  );
  const actionFor = (player: PaperPlayer): PaperAction => {
    const parsed = parsePaperAction(raw[player.id]);
    if (!parsed.ok) throw new TypeError(`Invalid action for ${player.id}: ${parsed.message}`);
    return parsed.action;
  };
  const actions = [actionFor(nextState.players[0]), actionFor(nextState.players[1])] as const;
  const origins = [positionOf(nextState.players[0]), positionOf(nextState.players[1])] as const;
  const targets = [
    targetPosition(origins[0], actions[0]),
    targetPosition(origins[1], actions[1]),
  ] as const;
  const causes: [Set<PaperResetCause>, Set<PaperResetCause>] = [new Set(), new Set()];
  const events: PaperEvent[] = [];
  for (const player of nextState.players) {
    const slot = player.slot;
    const target = targets[slot];
    if (
      target.x < 0 ||
      target.x >= nextState.width ||
      target.y < 0 ||
      target.y >= nextState.height
    ) {
      causes[slot].add("boundary");
      continue;
    }
    const trail = nextState.trails[target.y * nextState.width + target.x];
    if (trail === slot && actions[slot].type === "move") causes[slot].add("self-trail");
    if (trail === 1 - slot) {
      const victimSlot = slot === 0 ? 1 : 0;
      causes[victimSlot].add("trail-cut");
      events.push({
        type: "trail-cut",
        playerId: nextState.players[victimSlot].id,
        attackerId: player.id,
        position: { ...target },
      });
    }
  }
  if (samePosition(targets[0], targets[1])) {
    causes[0].add("head-collision");
    causes[1].add("head-collision");
  } else if (
    actions[0].type === "move" &&
    actions[1].type === "move" &&
    samePosition(targets[0], origins[1]) &&
    samePosition(targets[1], origins[0])
  ) {
    causes[0].add("head-swap");
    causes[1].add("head-swap");
  }
  // A reset player keeps its territory, loses its trail and returns to its spawn
  // instead of moving, so the head of the tick is the spawn cell.
  const heads: [Position, Position] = [
    causes[0].size > 0 ? { ...nextState.spawns[0] } : { ...targets[0] },
    causes[1].size > 0 ? { ...nextState.spawns[1] } : { ...targets[1] },
  ];
  // A spawn cell that the opponent reaches in the same tick would end on one cell
  // with two heads, so both heads reset instead.
  if (samePosition(heads[0], heads[1])) {
    causes[0].add("head-collision");
    causes[1].add("head-collision");
    heads[0] = { ...nextState.spawns[0] };
    heads[1] = { ...nextState.spawns[1] };
  }
  for (const player of nextState.players) {
    const slot = player.slot;
    if (causes[slot].size === 0) continue;
    player.position = { ...heads[slot] };
    clearTrail(nextState, slot);
    events.push({
      type: "reset",
      playerId: player.id,
      from: { ...origins[slot] },
      to: { ...heads[slot] },
      causes: RESET_CAUSES.filter((cause) => causes[slot].has(cause)),
    });
  }
  const closing = new Set<0 | 1>();
  for (const player of nextState.players) {
    const slot = player.slot;
    if (causes[slot].size > 0) continue;
    player.position = { ...heads[slot] };
    if (actions[slot].type === "move")
      events.push({
        type: "move",
        playerId: player.id,
        from: { ...origins[slot] },
        to: { ...heads[slot] },
      });
    const index = heads[slot].y * nextState.width + heads[slot].x;
    if (nextState.territory[index] !== slot) {
      nextState.trails[index] = slot;
    } else if (nextState.trails.includes(slot)) closing.add(slot);
  }
  // Compute both claim sets before applying any territory change.
  const claims = [
    closing.has(0) ? captureCells(nextState, 0) : new Set<number>(),
    closing.has(1) ? captureCells(nextState, 1) : new Set<number>(),
  ] as const;
  const gained: [number[], number[]] = [[], []];
  for (let index = 0; index < nextState.territory.length; index++) {
    const first = claims[0].has(index);
    const second = claims[1].has(index);
    if (first === second) continue;
    const slot = first ? 0 : 1;
    if (nextState.territory[index] !== slot) gained[slot].push(index);
    nextState.territory[index] = slot;
  }
  for (const player of nextState.players) {
    if (closing.has(player.slot))
      events.push({ type: "capture", playerId: player.id, cells: gained[player.slot] });
    const position = positionOf(player);
    const index = position.y * nextState.width + position.x;
    if (closing.has(player.slot) || nextState.territory[index] === player.slot) {
      clearTrail(nextState, player.slot);
    }
    if (nextState.territory[index] !== player.slot && !nextState.trails.includes(player.slot)) {
      nextState.trails[index] = player.slot;
    }
  }
  nextState.tick++;
  const result = outcome(nextState);
  return result ? { nextState, events, result } : { nextState, events };
}

export const paperRules: PaperRules = {
  init: initPaper,
  observe(state, playerId) {
    const snapshot = parsePaperState(state);
    const player = findPlayer(snapshot, playerId);
    if (!player.alive || terminal(snapshot)) return null;
    return { ...snapshot, selfId: player.id, selfSlot: player.slot };
  },
  parseAction: parsePaperAction,
  defaultAction(state, playerId) {
    findPlayer(state, playerId);
    return { type: "idle" };
  },
  step,
};
