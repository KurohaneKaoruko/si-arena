import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { cloneJson, resolveResourceLimits, type JsonObject } from "@si-arena/protocol";
import { MemoryReplaySink, replayMatch, runMatch, type PlayerExecutor } from "@si-arena/engine";
import { SandboxPlayer } from "@si-arena/sandbox";
import { officialBotUrl, tankGame, TANK_SDK_SOURCE } from "@si-arena/game-tank/game";
import type {
  TankAction,
  TankObservation,
  TankState,
  TankTickInput,
} from "@si-arena/game-tank/sdk";
import { IDS, init, required } from "./helpers";

type CreateGame = (
  observation: unknown,
  channel: { submit(action: TankAction): void; reject(message: string): never },
) => TankTickInput["game"];
type Tick = (input: { game: TankTickInput["game"]; Memory: JsonObject }) => void;

let directory = "";
let createGame: CreateGame;
let officialTick: Tick;

// The trusted SDK and official bot run in-process here to replay whole matches quickly;
// the sandbox test below runs the same bot exactly as the platform does.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "tank-sdk-"));
  const sdk = join(directory, "sdk.mjs");
  await writeFile(sdk, TANK_SDK_SOURCE);
  createGame = ((await import(pathToFileURL(sdk).href)) as { default: CreateGame }).default;
  officialTick = ((await import(officialBotUrl.href)) as { default: Tick }).default;
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function inProcess(matchId: string, playerId: string): PlayerExecutor<TankObservation, TankAction> {
  let memory: JsonObject = {};
  return {
    async execute(tick, observation, defaultAction) {
      let action = defaultAction;
      const game = createGame(observation, {
        submit: (next) => {
          action = next;
        },
        reject: (message) => {
          throw new Error(message);
        },
      });
      const Memory = cloneJson(memory);
      officialTick({ game, Memory });
      memory = cloneJson(Memory);
      return { matchId, playerId, tick, executionId: `${playerId}-${tick}`, ok: true, action };
    },
    async close() {},
  };
}

const participants = () => IDS.map((id, slot) => ({ id, slot, name: id, official: true }));

test("two official bots play full matches that replay to the same result", async () => {
  const reasons = new Set<string>();
  for (const seed of [7, 8, 9]) {
    const sink = new MemoryReplaySink<TankState, TankAction>();
    const matchId = `tank-${seed}`;
    const played = await runMatch({
      matchId,
      game: tankGame,
      players: participants(),
      seed,
      sink,
      async createExecutor(player) {
        return inProcess(matchId, player.id);
      },
    });
    expect(played.result.players).toHaveLength(2);
    expect(played.result.players.some((player) => player.rank === 1)).toBe(true);
    expect(["elimination", "tick-limit"]).toContain(played.result.reason);
    reasons.add(played.result.reason);
    expect(sink.replay.initialState).toStrictEqual(init(seed));
    const replayed = await replayMatch(JSON.parse(JSON.stringify(sink.replay)), tankGame);
    expect(replayed).toStrictEqual(played);
  }
  expect(reasons.has("elimination"), "official bots do shoot each other").toBe(true);
}, 60000);

test("two official bots play a full match in the real sandbox without errors", async () => {
  const source = await readFile(officialBotUrl, "utf8");
  // CPU bills real thread time, so the strict release cpuMs passes on a fast
  // core while shared CI runners several times slower turn the bot's rare GC
  // spikes into CPU_LIMIT overruns. The whole match — engine budget checks,
  // executor limits and the replay's fixed-release comparison — runs on this
  // one relaxed-cpuMs copy so every party agrees; all else stays at release.
  const relaxedGame: typeof tankGame = {
    ...tankGame,
    manifest: {
      ...tankGame.manifest,
      resolvedLimits: resolveResourceLimits({
        ...tankGame.manifest.resolvedLimits,
        cpuMs: 200,
      }),
    },
  };
  const sink = new MemoryReplaySink<TankState, TankAction>();
  const played = await runMatch({
    matchId: "tank-sandbox",
    game: relaxedGame,
    players: participants(),
    seed: 3,
    sink,
    async createExecutor(player, context) {
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source,
        sdkSource: TANK_SDK_SOURCE,
        parseAction: tankGame.rules.parseAction,
        defaultAction: { type: "idle" },
      });
    },
  });
  expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
  expect(played.result.completedTicks).toBeGreaterThan(0);
  expect(played.result.completedTicks).toBeLessThanOrEqual(600);
  expect(await replayMatch(sink.replay, relaxedGame)).toStrictEqual(played);
}, 120000);

test("the SDK exposes basic commands and frozen public facts only", async () => {
  const state = init();
  const player = await SandboxPlayer.create({
    matchId: "tank-api",
    playerId: "beta",
    limits: resolveResourceLimits({ cpuMs: 100 }),
    sdkSource: TANK_SDK_SOURCE,
    defaultAction: { type: "idle" },
    parseAction: tankGame.rules.parseAction,
    source: `export default ({game,Memory})=>{
      Memory.before=game.self.position.x;
      game.self.move('up');game.self.idle();game.self.fire();game.self.move('left');
      Memory.after=game.self.position.x;
      Memory.self=[game.self.id,game.self.slot,game.self.facing,game.self.hp,game.self.bulletInFlight];
      Memory.opponent=[game.opponent.id,game.opponent.slot,game.opponent.position.x];
      Memory.methods=Object.keys(game.self).filter((k)=>typeof game.self[k]==='function');
      Memory.views=[game.tick,game.maxTicks,game.eliminated.length,game.events.length,game.bullets.length,game.board.width,game.board.height];
      Memory.frozen=Object.isFrozen(game.board.cells)&&Object.isFrozen(game.bullets)&&Object.isFrozen(game.self.position)&&Object.isFrozen(game.opponent);
      Memory.hidden=['rngState','tanks','opponents','path','threats'].every((k)=>!(k in game));
    }`,
  });
  try {
    const result = await player.execute(0, required(tankGame.rules.observe(state, "beta")));
    expect(result).toMatchObject({
      ok: true,
      action: { type: "move", direction: "left" },
      memory: {
        before: 19,
        after: 19,
        self: ["beta", 1, "left", 3, false],
        opponent: ["alpha", 0, 1],
        methods: ["move", "fire", "idle"],
        views: [0, 600, 0, 0, 0, 21, 15],
        frozen: true,
        hidden: true,
      },
    });
    const fired = await SandboxPlayer.create({
      matchId: "tank-api-fire",
      playerId: "alpha",
      limits: resolveResourceLimits({ cpuMs: 100 }),
      sdkSource: TANK_SDK_SOURCE,
      defaultAction: { type: "idle" },
      parseAction: tankGame.rules.parseAction,
      source: `export default ({game})=>{game.self.fire()}`,
    });
    try {
      const shot = await fired.execute(0, required(tankGame.rules.observe(state, "alpha")));
      expect(shot).toMatchObject({ ok: true, action: { type: "fire" } });
    } finally {
      await fired.close();
    }
  } finally {
    await player.close();
  }
});
