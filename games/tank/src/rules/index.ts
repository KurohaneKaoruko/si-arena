import {
  isJsonSnapshot,
  type DeepReadonly,
  type GameResult,
  type GameRules,
} from "@si-arena/protocol";
import type { TankAction, TankEvent, TankObservation, TankPosition, TankState } from "../sdk";
import { parseTankAction } from "./actions";
import { observeTank, tankFinished } from "./observation";
import { DELTAS, cellIndex, initTank, insideMap, parseTankState, samePosition } from "./state";
import { readRecord } from "./validation";

export { parseTankAction } from "./actions";
export { parseTankState } from "./state";
export { parseTankObservation } from "./observation";
export type { TankEvent } from "../sdk";

export interface TankResult extends GameResult {
  /** `elimination` once a tank is destroyed, otherwise `tick-limit`. */
  reason: "elimination" | "tick-limit";
  players: Array<{ id: string; rank: number; score: number; alive: boolean }>;
}
export interface TankStepResult {
  nextState: TankState;
  events: TankEvent[];
  result?: TankResult;
}
export interface TankRules extends GameRules<TankState, TankObservation, TankAction, TankEvent> {
  step(
    state: DeepReadonly<TankState>,
    actions: DeepReadonly<Record<string, TankAction>>,
  ): TankStepResult;
}

/** The survivor, or the tank with more hp at the limit, ranks first; equal hp shares rank 1. */
function outcome(state: TankState): TankResult | undefined {
  if (!tankFinished(state)) return undefined;
  return {
    reason: state.tanks.some((tank) => tank.death) ? "elimination" : "tick-limit",
    completedTicks: state.tick,
    players: state.tanks.map((tank) => ({
      id: tank.id,
      rank: state.tanks.some((other) => other.hp > tank.hp) ? 2 : 1,
      score: tank.hp,
      alive: tank.death === null,
    })),
  };
}

const advance = (position: TankPosition, direction: keyof typeof DELTAS): TankPosition => ({
  x: position.x + DELTAS[direction][0],
  y: position.y + DELTAS[direction][1],
});

function step(
  state: DeepReadonly<TankState>,
  rawActions: DeepReadonly<Record<string, TankAction>>,
): TankStepResult {
  const next = parseTankState(state);
  if (tankFinished(next)) throw new TypeError("Cannot step a finished Tank game");
  const { cells, tanks, bullets } = next;
  const raw = readRecord(
    rawActions,
    tanks.map((tank) => tank.id),
    "Tank tick actions",
  );
  const actions = tanks.map((tank) => {
    const parsed = parseTankAction(raw[tank.id]);
    if (!parsed.ok) throw new TypeError(`Invalid action for ${tank.id}: ${parsed.message}`);
    return parsed.action;
  });
  const moves: TankEvent[] = [];
  const fires: TankEvent[] = [];
  const hits: TankEvent[] = [];
  const cancels: TankEvent[] = [];
  const deaths: TankEvent[] = [];
  const broken = tanks.map((): number[] => []);
  // 1. Turn, then move. A target is blocked by the map edge, any wall, a shared target, a
  // swap, or the opponent's cell while the opponent does not move away.
  const starts = tanks.map((tank) => ({ ...tank.position! }));
  const wants = tanks.map((tank, slot): TankPosition | null => {
    const action = actions[slot]!;
    if (action.type !== "move") return null;
    tank.facing = action.direction;
    const target = advance(tank.position!, action.direction);
    return insideMap(target) && cells[cellIndex(target)] === 0 ? target : null;
  });
  const [first, second] = wants;
  if (first && second && samePosition(first, second)) wants[0] = wants[1] = null;
  if (first && second && samePosition(first, starts[1]!) && samePosition(second, starts[0]!))
    wants[0] = wants[1] = null;
  for (const slot of [0, 1]) {
    const want = wants[slot];
    if (want && samePosition(want, starts[1 - slot]!) && wants[1 - slot] === null)
      wants[slot] = null;
  }
  tanks.forEach((tank, slot) => {
    if (actions[slot]!.type !== "move") return;
    tank.position = wants[slot] ?? starts[slot]!;
    moves.push({
      type: "move",
      playerId: tank.id,
      from: starts[slot]!,
      to: { ...tank.position },
      facing: tank.facing,
    });
  });
  // 2. Fire from the own cell along the facing, unless an own bullet is still flying.
  tanks.forEach((tank, slot) => {
    if (actions[slot]!.type !== "fire" || bullets.some((bullet) => bullet.owner === slot)) return;
    bullets.push({ position: { ...tank.position! }, direction: tank.facing, owner: slot });
    fires.push({
      type: "fire",
      playerId: tank.id,
      position: { ...tank.position! },
      direction: tank.facing,
    });
  });
  // 3. Bullets fly two cells in two sub-steps. In each, all advance together, then settle once:
  // two bullets on one cell or swapping cells cancel before anything else; the rest vanish at
  // the edge or steel, break a brick, or hit the opponent. A tank at 0 hp still occupies its
  // cell until cleanup and absorbs bullets without further effect.
  for (let subStep = 0; subStep < 2 && bullets.length; subStep++) {
    const from = bullets.map((bullet) => bullet.position);
    for (const bullet of bullets) bullet.position = advance(bullet.position, bullet.direction);
    const gone = bullets.map(() => false);
    for (let i = 0; i < bullets.length; i++)
      for (let j = i + 1; j < bullets.length; j++) {
        const here = bullets[i]!.position;
        const there = bullets[j]!.position;
        const met = insideMap(here) && samePosition(here, there);
        const swapped = samePosition(here, from[j]!) && samePosition(there, from[i]!);
        if (!met && !swapped) continue;
        gone[i] = gone[j] = true;
        cancels.push({ type: "bullets-cancelled", position: { ...here } });
      }
    bullets.forEach((bullet, index) => {
      if (gone[index]) return;
      gone[index] = true;
      const position = bullet.position;
      if (!insideMap(position)) return;
      const cell = cellIndex(position);
      if (cells[cell] === 2) return;
      if (cells[cell] === 1) {
        cells[cell] = 0;
        broken[bullet.owner]!.push(cell);
        return;
      }
      const victim = tanks[1 - bullet.owner]!;
      if (!samePosition(victim.position!, position)) {
        gone[index] = false;
        return;
      }
      if (victim.hp === 0) return;
      victim.hp--;
      hits.push({
        type: "hit",
        playerId: victim.id,
        attackerId: tanks[bullet.owner]!.id,
        position: { ...position },
        hp: victim.hp,
      });
    });
    for (let index = bullets.length - 1; index >= 0; index--)
      if (gone[index]) bullets.splice(index, 1);
  }
  const bricks: TankEvent[] = tanks.flatMap((tank, slot) =>
    broken[slot]!.length
      ? [
          {
            type: "brick-destroyed" as const,
            attackerId: tank.id,
            cells: broken[slot]!.toSorted((a, b) => a - b),
          },
        ]
      : [],
  );
  // 4. A tank at 0 hp is destroyed: it leaves the map with its bullet.
  const tick = next.tick + 1;
  for (const tank of tanks) {
    if (tank.hp > 0) continue;
    deaths.push({ type: "death", playerId: tank.id, position: tank.position! });
    tank.position = null;
    tank.death = { tick };
    for (let index = bullets.length - 1; index >= 0; index--)
      if (bullets[index]!.owner === tank.slot) bullets.splice(index, 1);
  }
  next.tick = tick;
  // Reuse the validated immutable terrain when nothing broke; replay caches stay unchanged.
  if (isJsonSnapshot(state.cells) && next.cells.every((cell, index) => cell === state.cells[index]))
    next.cells = state.cells as number[];
  const events = [...moves, ...fires, ...hits, ...bricks, ...cancels, ...deaths];
  const result = outcome(next);
  return result ? { nextState: next, events, result } : { nextState: next, events };
}

export const tankRules: TankRules = {
  init: initTank,
  observe: observeTank,
  parseAction: parseTankAction,
  defaultAction(state, playerId) {
    if (!state.tanks.some((tank) => tank.id === playerId))
      throw new TypeError("Unknown Tank player");
    return { type: "idle" };
  },
  step,
};
