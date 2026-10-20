import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { cloneJson, resolveResourceLimits } from "@si-arena/protocol";
import { paperGame, officialBotUrl, PAPER_SDK_SOURCE } from "@si-arena/game-paper/game";
import type { PaperAction, PaperState } from "@si-arena/game-paper/sdk";
import { MatchLogBudget, SandboxPlayer } from "@si-arena/sandbox";
import { MemoryReplaySink, replayMatch, runMatch } from "../src";
import { toyGame, players, type ToyAction, type ToyState } from "./helpers";

type Cell = readonly [number, number];

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
  // A full 600-tick match on slow shared CI runners needs well over the
  // default 5s test timeout.
}, 60000);

test("the official Paper bot keeps to the safe directions when the opponent head is inside its territory", async () => {
  const source = await readFile(officialBotUrl, "utf8");
  const limits = paperGame.manifest.resolvedLimits;
  const width = 40;
  // The bot owns a home block and reaches a sweep anchor through it, while
  // the opponent head stands on the own border next to the bot head. The
  // walk to the anchor used to step onto that head, which is a head collision
  // and resets both heads to their spawns.
  const home: Cell[] = [
    [33, 13],
    [34, 13],
    [35, 13],
    [33, 14],
    [34, 14],
    [35, 14],
    [33, 15],
    [34, 15],
    [35, 15],
  ];
  const scenarios: { extra: Cell[]; head: Cell; enemy: Cell }[] = [
    {
      extra: [
        [36, 14],
        [37, 14],
      ],
      head: [37, 14],
      enemy: [36, 14],
    },
    {
      extra: [
        [36, 15],
        [35, 16],
        [34, 16],
        [36, 14],
        [36, 13],
        [35, 12],
        [34, 12],
        [36, 16],
        [37, 16],
        [33, 16],
        [36, 12],
        [32, 16],
        [37, 15],
      ],
      head: [35, 12],
      enemy: [35, 13],
    },
    {
      extra: [
        [34, 16],
        [34, 17],
        [35, 16],
        [36, 16],
        [34, 12],
        [35, 13],
        [33, 13],
        [33, 14],
        [33, 15],
      ],
      head: [34, 12],
      enemy: [34, 13],
    },
  ];
  const bot = await SandboxPlayer.create({
    matchId: "paper-bot-safety",
    playerId: "official",
    source,
    sdkSource: PAPER_SDK_SOURCE,
    limits,
    isolation: { kind: "local" },
    parseAction: paperGame.rules.parseAction,
    defaultAction: { type: "idle" },
  });
  const probe = await SandboxPlayer.create({
    matchId: "paper-bot-safety",
    playerId: "probe",
    source: `export default ({observation,Memory,sdk})=>{Memory.safe=sdk.safeMoves(observation);return {type:'idle'}}`,
    sdkSource: PAPER_SDK_SOURCE,
    limits,
    isolation: { kind: "local" },
    parseAction: paperGame.rules.parseAction,
    defaultAction: { type: "idle" },
  });
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const state = paperGame.rules.init({
        seed: 2,
        players: [
          { id: "a", slot: 0 },
          { id: "b", slot: 1 },
        ],
        config: paperGame.manifest.config,
      });
      state.territory.fill(-1);
      state.trails.fill(-1);
      for (const [x, y] of [...home, ...scenario.extra]) state.territory[y * width + x] = 0;
      state.players[0].position = { x: scenario.head[0], y: scenario.head[1] };
      state.players[1].position = { x: scenario.enemy[0], y: scenario.enemy[1] };
      state.trails[scenario.enemy[1] * width + scenario.enemy[0]] = 1;
      const observation = paperGame.rules.observe(state, "a");
      const action = await bot.execute(index, observation);
      const safe = await probe.execute(index, observation);
      expect(action.ok).toBe(true);
      expect(safe.ok).toBe(true);
      const directions = safe.memory.safe;
      expect(Array.isArray(directions)).toBe(true);
      if (action.action.type === "move")
        expect(directions as string[]).toContain(action.action.direction);
    }
  } finally {
    await bot.close();
    await probe.close();
  }
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
