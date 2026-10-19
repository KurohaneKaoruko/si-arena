import { cloneJson, resolveResourceLimits } from "@si-arena/protocol";
import { MemoryReplaySink, runMatch, type GameDefinition } from "@si-arena/engine";

export interface State {
  tick: number;
  counter: number;
  players: Array<{ id: string; slot: number }>;
}
export type Action = { add: number };
export type Observation = { tick: number; selfId: string; counter: number };

export function counterGame(
  maxTicks = 1200,
): GameDefinition<State, Observation, Action, { tick: number }> {
  return {
    manifest: {
      id: "counter",
      name: "Counter",
      description: "Playback test",
      release: "counter@1",
      botProtocolVersion: 1,
      minPlayers: 2,
      maxPlayers: 2,
      maxTicks,
      config: {},
      resolvedLimits: resolveResourceLimits(),
    },
    parseConfig(raw) {
      if (!raw || typeof raw !== "object" || Object.keys(raw).length) throw new Error("Bad config");
      return {};
    },
    parseState(raw, context) {
      const state = cloneJson(raw) as State;
      if (
        !state ||
        !Number.isSafeInteger(state.tick) ||
        !Number.isFinite(state.counter) ||
        !Array.isArray(state.players) ||
        state.players.length !== 2 ||
        state.players.some((p, i) => p.id !== context.players[i]?.id || p.slot !== i)
      )
        throw new Error("Bad state");
      return state;
    },
    parseObservation(raw, context) {
      const observation = cloneJson(raw) as Observation;
      if (
        observation.tick !== context.tick ||
        observation.selfId !== context.playerId ||
        !Number.isFinite(observation.counter)
      )
        throw new Error("Bad observation");
      return observation;
    },
    rules: {
      init({ players }) {
        return { tick: 0, counter: 0, players };
      },
      observe(state, selfId) {
        return { tick: state.tick, counter: state.counter, selfId };
      },
      parseAction(raw) {
        if (
          raw &&
          typeof raw === "object" &&
          !Array.isArray(raw) &&
          Object.keys(raw).length === 1 &&
          (raw.add === 0 || raw.add === 1)
        )
          return { ok: true, action: { add: raw.add } };
        return { ok: false, message: "Expected add" };
      },
      defaultAction() {
        return { add: 0 };
      },
      step(state, actions) {
        const nextState = {
          tick: state.tick + 1,
          counter: state.counter + Object.values(actions).reduce((sum, a) => sum + a.add, 0),
          players: state.players.map((p) => ({ ...p })),
        };
        return {
          nextState,
          events: [{ tick: state.tick }],
          ...(nextState.tick === maxTicks
            ? {
                result: {
                  reason: "tick-limit",
                  completedTicks: maxTicks,
                  players: state.players.map((p) => ({
                    id: p.id,
                    rank: 1,
                    score: nextState.counter,
                  })),
                },
              }
            : {}),
        };
      },
    },
  };
}
export async function fixture(maxTicks = 1200, game = counterGame(maxTicks)) {
  const sink = new MemoryReplaySink<State, Action>();
  await runMatch({
    game,
    sink,
    matchId: "playback-fixture",
    seed: 42,
    captureLogs: true,
    players: [
      { id: "a", slot: 0, name: "Alpha", official: false },
      { id: "b", slot: 1, name: "Official", official: true },
    ],
    async createExecutor(player) {
      return {
        async execute(tick) {
          const fails = player.id === "a" && (tick === 0 || tick === 3);
          return {
            matchId: "playback-fixture",
            executionId: "fixture",
            playerId: player.id,
            tick,
            ok: !fails,
            action: { add: fails ? 0 : 1 },
            ...(fails
              ? { error: { type: "RUNTIME_ERROR" as const, message: "example failure" } }
              : {}),
            logs: [{ level: "log" as const, message: `<img src=x onerror=alert(1)> ${tick}` }],
          };
        },
        async close() {},
      };
    },
  });
  return { game, replay: sink.replay };
}
