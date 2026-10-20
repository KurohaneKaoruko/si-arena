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
          ? "export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;console.log(Memory.n);if(game.tick===1)throw new Error('boom');return game.submit({add:Memory.n})}"
          : "export default ({game,Memory})=>{game.submit(({add:0}));}";
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source,
        sdkSource: "export default (o,{submit})=>{submit({add:0});return {...o,submit}}",
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
        source: player.official ? source : "export default ()=>{}",
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
  // The official bot must play clean: a guest runtime losing an API the bot
  // relies on would degrade it to the idle default without failing loudly.
  const officialErrors = sink.replay.ticks.flatMap((tick) =>
    tick.errors?.official ? [tick.errors.official] : [],
  );
  expect(officialErrors).toEqual([]);
  expect(await replayMatch(sink.replay, paperGame)).toEqual(result);
  // A full 600-tick match on slow shared CI runners needs well over the
  // default 5s test timeout.
}, 60000);

// The release cpuMs assumes production-like hardware; shared CI runners execute
// the same guest work 2-3x slower. Measure this machine's steady guest speed
// with a spin of the reference size (about 10ms of guest work, far above the
// Linux thread-CPU accounting granularity) and scale CPU budgets by the same
// factor, mirroring the sandbox performance tests.
async function cpuSpeedFactor(): Promise<number> {
  const player = await SandboxPlayer.create({
    matchId: "paper-calibration",
    playerId: "calibration",
    source:
      "export default ({game,Memory})=>{let s=0;for(let i=0;i<200000;i++)s+=i;return game.submit({type:'idle'})}",
    sdkSource: "export default (o,{submit})=>{submit({type:'idle'});return {...o,submit}}",
    limits: resolveResourceLimits({ cpuMs: 1000, wallMs: 10000 }),
    isolation: { kind: "local" },
    parseAction: paperGame.rules.parseAction,
    defaultAction: { type: "idle" },
  });
  try {
    // The first tick pays one-time JIT warm-up; the second reflects steady cost.
    await player.execute(0, {});
    const steady = await player.execute(1, {});
    const baseline = steady.resources?.cpuUsedUs ?? 0;
    if (!steady.ok || baseline <= 0) throw new Error("CPU speed calibration failed");
    return Math.max(1, baseline / 10_000);
  } finally {
    await player.close();
  }
}

test("the official Paper bot keeps to the safe directions when the opponent head is inside its territory", async () => {
  const source = await readFile(officialBotUrl, "utf8");
  // Direction safety is the property under test here; budget compliance under
  // the raw release limits is covered by the full-match test above.
  const factor = await cpuSpeedFactor();
  const limits = resolveResourceLimits({
    ...paperGame.manifest.resolvedLimits,
    cpuMs: Math.ceil(paperGame.manifest.resolvedLimits.cpuMs * factor),
  });
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
      expect(action.ok).toBe(true);
      if (action.action.type === "move") {
        const delta = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[
          action.action.direction
        ]!;
        const x = scenario.head[0] + delta[0]!;
        const y = scenario.head[1] + delta[1]!;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(40);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(30);
        expect(state.trails[y * 40 + x]).not.toBe(0);
        expect([x, y]).not.toEqual(scenario.enemy);
      }
    }
  } finally {
    await bot.close();
  }
}, 30000);

test("Paper exposes only basic commands and immutable facts; commands do not immediately move the head", async () => {
  const state = paperGame.rules.init({
    seed: 2,
    players: [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
    config: paperGame.manifest.config,
  });
  const player = await SandboxPlayer.create({
    matchId: "basic-api",
    playerId: "a",
    limits: resolveResourceLimits({ cpuMs: 100 }),
    isolation: { kind: "local" },
    sdkSource: PAPER_SDK_SOURCE,
    defaultAction: { type: "idle" },
    parseAction: paperGame.rules.parseAction,
    source: `export default ({game,Memory})=>{
      Memory.before=game.self.position.x;
      game.self.move('up');game.self.idle();game.self.move('right');
      Memory.after=game.self.position.x;
      Memory.methods=Object.keys(game.self).filter(k=>typeof game.self[k]==='function');
      Memory.noStrategies=['homePath','safeMoves','threatDistance','expansion','rngState'].every(k=>!(k in game));
      Memory.frozen=Object.isFrozen(game.board.territory)&&Object.isFrozen(game.self.position)&&Object.isFrozen(game.opponent);
    }`,
  });
  try {
    const result = await player.execute(0, paperGame.rules.observe(state, "a"));
    expect(result).toMatchObject({
      ok: true,
      action: { type: "move", direction: "right" },
      memory: { before: 5, after: 5, methods: ["move", "idle"], noStrategies: true, frozen: true },
    });
    expect(state.players[0].position).toEqual({ x: 5, y: 14 });
  } finally {
    await player.close();
  }
});
