import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cloneJson, resolveResourceLimits } from "@si-arena/protocol";
import type { GameDefinition } from "@si-arena/engine";
import { defineLocalGame } from "../src";

interface State {
  tick: number;
  players: Array<{ id: string; slot: number; score: number }>;
}
type Observation = { tick: number; selfId: string };
type Action = { add: number };

export const localGame: GameDefinition<State, Observation, Action, never> = {
  manifest: {
    id: "counter",
    name: "Counter",
    description: "Local CLI integration fixture",
    release: "counter@1",
    botProtocolVersion: 1,
    minPlayers: 2,
    maxPlayers: 4,
    maxTicks: 3,
    config: {},
    resolvedLimits: resolveResourceLimits({ cpuMs: 100 }),
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
      !Array.isArray(state.players) ||
      state.players.length !== context.players.length ||
      state.players.some(
        (p, i) =>
          p.id !== context.players[i]?.id ||
          p.slot !== context.players[i]?.slot ||
          !Number.isSafeInteger(p.score),
      )
    )
      throw new Error("Bad state");
    return state;
  },
  parseObservation(raw, context) {
    const observation = cloneJson(raw) as Observation;
    if (
      !observation ||
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId
    )
      throw new Error("Bad observation");
    return observation;
  },
  rules: {
    init({ players }) {
      return { tick: 0, players: players.map((p) => ({ ...p, score: 0 })) };
    },
    observe(state, selfId) {
      return { tick: state.tick, selfId };
    },
    parseAction(raw) {
      if (
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        Object.keys(raw).length === 1 &&
        Number.isSafeInteger(raw.add) &&
        Number(raw.add) >= 0 &&
        Number(raw.add) <= 9
      )
        return { ok: true, action: { add: Number(raw.add) } };
      return { ok: false, message: "Expected small add" };
    },
    defaultAction() {
      return { add: 0 };
    },
    step(state, actions) {
      const nextState = {
        tick: state.tick + 1,
        players: state.players.map((p) => ({ ...p, score: p.score + (actions[p.id]?.add ?? 0) })),
      };
      return {
        nextState,
        events: [],
        ...(nextState.tick === 3
          ? {
              result: {
                reason: "tick-limit",
                completedTicks: 3,
                players: nextState.players.map((p) => ({
                  id: p.id,
                  rank: 1 + nextState.players.filter((other) => other.score > p.score).length,
                  score: p.score,
                })),
              },
            }
          : {}),
      };
    },
  },
};

export async function fixture(bot = "export default ({game,Memory})=>{game.submit(({add:1}));}") {
  const cwd = await mkdtemp(join(tmpdir(), "si-arena-cli-"));
  const official = join(cwd, "official.js");
  await writeFile(official, "export default ({game,Memory})=>{game.submit(({add:0}));}");
  const path = join(cwd, "bot with spaces.js");
  await writeFile(path, bot);
  const registration = defineLocalGame({
    game: localGame,
    sdkSource: "export default (o,{submit})=>{submit({add:0});return {...o,submit}}",
    officialBotUrl: pathToFileURL(official),
  });
  const lines: string[] = [];
  return {
    cwd,
    official,
    path,
    registration,
    lines,
    context: {
      cwd,
      games: [registration],
      write: (line: string) => {
        lines.push(line);
      },
    },
    cleanup: () => rm(cwd, { recursive: true, force: true }),
  };
}
