import { cloneJson, resolveResourceLimits, type JsonValue } from "@si-arena/protocol";
import type { GameDefinition } from "@si-arena/engine";
type State = { tick: number; players: { id: string; slot: number; score: number }[] };
type Observation = { tick: number; selfId: string };
type Action = { add: number };
export const sdkSource =
  "export default (o,{submit})=>{submit({add:0});return {...o,add(value){submit({add:value})}}}";
export const game: GameDefinition<State, Observation, Action, never> = {
  manifest: {
    id: "runner-test",
    name: "Runner test",
    description: "Trusted fixture",
    release: "runner-test@1",
    botProtocolVersion: 1,
    minPlayers: 2,
    maxPlayers: 5,
    maxTicks: 4,
    config: {},
    resolvedLimits: resolveResourceLimits({ cpuMs: 100 }),
  },
  parseConfig(raw) {
    if (JSON.stringify(raw) !== "{}") throw new Error("Invalid config");
    return {};
  },
  parseState(raw, context) {
    const state = cloneJson(raw) as State;
    if (
      !Number.isSafeInteger(state.tick) ||
      state.players.some(
        (p, i) => p.id !== context.players[i]?.id || p.slot !== i || !Number.isSafeInteger(p.score),
      )
    )
      throw new Error("Invalid state");
    return state;
  },
  parseObservation(raw, context) {
    const observation = cloneJson(raw) as Observation;
    if (observation.tick !== context.tick || observation.selfId !== context.playerId)
      throw new Error("Invalid observation");
    return observation;
  },
  rules: {
    init({ players }) {
      return { tick: 0, players: players.map((p) => ({ ...p, score: 0 })) };
    },
    observe(state, selfId) {
      return { tick: state.tick, selfId };
    },
    parseAction(raw: JsonValue) {
      if (
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        Number.isSafeInteger(raw.add) &&
        Number(raw.add) >= 0 &&
        Number(raw.add) < 10
      )
        return { ok: true, action: { add: Number(raw.add) } };
      return { ok: false, message: "Invalid add" };
    },
    defaultAction() {
      return { add: 0 };
    },
    step(state, actions) {
      const nextState = {
        tick: state.tick + 1,
        players: state.players.map((p) => ({ ...p, score: p.score + actions[p.id]!.add })),
      };
      return {
        nextState,
        events: [],
        ...(nextState.tick === 4
          ? {
              result: {
                reason: "tick-limit",
                completedTicks: 4,
                players: nextState.players.map((p) => ({
                  id: p.id,
                  rank: 1 + nextState.players.filter((q) => q.score > p.score).length,
                  score: p.score,
                })),
              },
            }
          : {}),
      };
    },
  },
};
export const crashGame = {
  ...game,
  rules: {
    ...game.rules,
    step() {
      process.exit(70);
    },
  },
};
