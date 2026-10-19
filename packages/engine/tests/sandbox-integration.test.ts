import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { cloneJson, resolveResourceLimits } from "@si-arena/protocol";
import { paperGame, officialBotUrl, PAPER_SDK_SOURCE } from "@si-arena/game-paper/game";
import type { PaperAction, PaperState } from "@si-arena/game-paper/sdk";
import { MatchLogBudget, SandboxPlayer } from "@si-arena/sandbox";
import { MemoryReplaySink, replayMatch, runMatch } from "../src";
import { toyGame, players, type ToyAction, type ToyState } from "./helpers";

test("real QuickJS matches recover from player errors, preserve Memory and generate code-free replay", async () => {
  const limits = resolveResourceLimits({ cpuMs: 100 });
  const game = { ...toyGame, manifest: { ...toyGame.manifest, resolvedLimits: limits } };
  const sink = new MemoryReplaySink<ToyState, ToyAction>();
  const budget = new MatchLogBudget(limits.logs.matchBytes);
  let invocations = 0;
  const result = await runMatch({
    matchId: "integration",
    game,
    players: cloneJson(players),
    seed: 1,
    captureLogs: true,
    sink,
    async createExecutor(player, context) {
      invocations++;
      const source =
        player.id === "a"
          ? `export default ({observation,Memory})=>{Memory.n=(Memory.n??0)+1;console.log(Memory.n);if(observation.tick===1)throw new Error('boom');return {add:Memory.n}}`
          : `export default ()=>({add:0})`;
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source,
        isolation: { kind: "local" },
        parseAction: game.rules.parseAction,
        defaultAction: { add: 0 },
        logBudget: budget,
      });
    },
  });
  expect(result.finalState.total).toBe(3);
  const replay = sink.replay;
  expect(replay.ticks[1]?.errors?.a?.type).toBe("RUNTIME_ERROR");
  expect(replay.ticks.flatMap((tick) => tick.logs?.a ?? []).map((log) => log.message)).toEqual([
    "1",
    "2",
    "2",
  ]);
  expect(replay.ticks[1]?.actions.a).toEqual({ add: 0 });
  expect(JSON.stringify(replay)).not.toContain("export default");
  expect(
    replay.ticks.every((tick) => !Object.hasOwn(tick, "memory") && !Object.hasOwn(tick, "state")),
  ).toBe(true);
  expect(await replayMatch(replay, game)).toEqual(result);
  expect(invocations).toBe(2);
}, 15000);

test("the published official Paper bot plays under the normal release limits and replays identically", async () => {
  const source = await readFile(officialBotUrl, "utf8");
  const sink = new MemoryReplaySink<PaperState, PaperAction>();
  const participants = [
    { id: "official", slot: 0, name: "Official", official: true },
    { id: "idle", slot: 1, name: "Idle", official: false },
  ];
  const result = await runMatch({
    matchId: "paper-integration",
    game: paperGame,
    players: participants,
    seed: 2,
    sink,
    async createExecutor(player, context) {
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source: player.official ? source : `export default ()=>({type:'idle'})`,
        sdkSource: PAPER_SDK_SOURCE,
        isolation: { kind: "local" },
        parseAction: paperGame.rules.parseAction,
        defaultAction: { type: "idle" },
      });
    },
  });
  expect(result.result.completedTicks).toBeGreaterThan(1);
  expect(result.result.completedTicks).toBeLessThanOrEqual(600);
  expect(result.result.players.find((player) => player.id === "official")!.score).toBeGreaterThan(
    9,
  );
  expect(result.result.players.find((player) => player.id === "official")!.rank).toBe(1);
  expect(await replayMatch(sink.replay, paperGame)).toEqual(result);
}, 30000);

test("Paper SDK executes inside the guest and offers a shortest legal route home", async () => {
  let state = paperGame.rules.init({
    seed: 2,
    players: [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
    config: paperGame.manifest.config,
  });
  for (let i = 0; i < 2; i++)
    state = paperGame.rules.step(state, {
      a: { type: "move", direction: "right" },
      b: { type: "idle" },
    }).nextState;
  const player = await SandboxPlayer.create({
    matchId: "sdk",
    playerId: "a",
    source: `export default ({observation,Memory,sdk})=>{Memory.path=sdk.homePath(observation);Memory.distance=sdk.threatDistance(observation);Memory.safe=sdk.safeMoves(observation);return {type:'idle'}}`,
    sdkSource: PAPER_SDK_SOURCE,
    limits: resolveResourceLimits({ cpuMs: 100 }),
    isolation: { kind: "local" },
    parseAction: paperGame.rules.parseAction,
    defaultAction: { type: "idle" },
  });
  try {
    const result = await player.execute(0, paperGame.rules.observe(state, "a"));
    expect(result.ok).toBe(true);
    expect(result.memory.path).toEqual(["left"]);
    expect(result.memory.distance).toBe(27);
    expect(result.memory.safe).toContain("left");
  } finally {
    await player.close();
  }
});
