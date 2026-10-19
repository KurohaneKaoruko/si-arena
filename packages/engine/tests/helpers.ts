import { cloneJson, resolveResourceLimits, type JsonValue } from "@si-arena/protocol";
import {
  MemoryReplaySink,
  type ExecutorOutcome,
  type GameDefinition,
  type MatchOptions,
  type PlayerExecutor,
  type ReplayPlayer,
} from "../src";

export interface ToyState {
  tick: number;
  total: number;
  players: Array<{ id: string; slot: number }>;
}
export interface ToyObservation {
  tick: number;
  total: number;
  selfId: string;
}
export type ToyAction = { add: number };
export const players: ReplayPlayer[] = [
  { id: "a", slot: 0, name: "Alpha", official: false },
  { id: "b", slot: 1, name: "Official", official: true },
];
export const toyGame: GameDefinition<ToyState, ToyObservation, ToyAction, { type: string }> = {
  manifest: {
    id: "toy",
    name: "Toy",
    description: "Engine fixture",
    release: "toy@1",
    botProtocolVersion: 1,
    minPlayers: 2,
    maxPlayers: 2,
    maxTicks: 3,
    config: {},
    resolvedLimits: resolveResourceLimits(),
  },
  parseConfig(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length)
      throw new TypeError("Invalid config");
    return {};
  },
  parseState(raw, context) {
    const state = cloneJson(raw) as ToyState;
    if (
      !state ||
      !Number.isSafeInteger(state.tick) ||
      typeof state.total !== "number" ||
      !Number.isFinite(state.total) ||
      !Array.isArray(state.players) ||
      state.players.length !== context.players.length ||
      state.players.some(
        (p, i) => p.id !== context.players[i]?.id || p.slot !== context.players[i]?.slot,
      )
    )
      throw new TypeError("Invalid toy state");
    return state;
  },
  parseObservation(raw, context) {
    const observation = cloneJson(raw) as ToyObservation;
    if (
      !observation ||
      Object.keys(observation).length !== 3 ||
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId ||
      typeof observation.total !== "number" ||
      !Number.isFinite(observation.total)
    )
      throw new TypeError("Invalid toy observation");
    return observation;
  },
  rules: {
    init({ players: input }) {
      return { tick: 0, total: 0, players: cloneJson(input) };
    },
    observe(state, id) {
      if (state.tick >= 3) return null;
      return { tick: state.tick, total: state.total, selfId: id };
    },
    defaultAction() {
      return { add: 0 };
    },
    parseAction(raw: JsonValue) {
      if (
        raw !== null &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        Object.keys(raw).length === 1 &&
        Number.isSafeInteger(raw.add) &&
        Number(raw.add) >= 0 &&
        Number(raw.add) <= 2
      )
        return { ok: true, action: { add: Number(raw.add) } };
      return { ok: false, message: "Expected a small add action" };
    },
    step(state, actions) {
      const nextState = {
        tick: state.tick + 1,
        total: state.total + Object.values(actions).reduce((sum, action) => sum + action.add, 0),
        players: state.players.map((p) => ({ ...p })),
      };
      return {
        nextState,
        events: [{ type: "advance" }],
        ...(nextState.tick === 3
          ? {
              result: {
                reason: "tick-limit",
                completedTicks: 3,
                players: state.players.map((p) => ({ id: p.id, rank: 1, score: nextState.total })),
              },
            }
          : {}),
      };
    },
  },
};
export function outcome(
  id: string,
  tick: number,
  action: ToyAction = { add: 1 },
): ExecutorOutcome<ToyAction> {
  return { matchId: "m", playerId: id, tick, executionId: `generation-${id}`, ok: true, action };
}
export function fixture(
  overrides: Partial<MatchOptions<ToyState, ToyObservation, ToyAction, { type: string }>> = {},
) {
  const sink = new MemoryReplaySink<ToyState, ToyAction>();
  const calls: Array<{ id: string; observation: ToyObservation }> = [];
  const closed: string[] = [];
  const options: MatchOptions<ToyState, ToyObservation, ToyAction, { type: string }> = {
    matchId: "m",
    game: toyGame,
    players: cloneJson(players),
    seed: 1,
    sink,
    async createExecutor(player) {
      const executor: PlayerExecutor<ToyObservation, ToyAction> = {
        async execute(tick, observation) {
          calls.push({ id: player.id, observation: cloneJson(observation) });
          return outcome(player.id, tick);
        },
        async close() {
          closed.push(player.id);
        },
      };
      return executor;
    },
    ...overrides,
  };
  return { options, sink, calls, closed };
}
