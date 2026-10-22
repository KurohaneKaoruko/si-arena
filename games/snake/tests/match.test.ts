import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { cloneJson, resolveResourceLimits, type JsonObject } from "@si-arena/protocol";
import { MemoryReplaySink, replayMatch, runMatch, type PlayerExecutor } from "@si-arena/engine";
import { SandboxPlayer } from "@si-arena/sandbox";
import { officialBotUrl, snakeGame, SNAKE_SDK_SOURCE } from "@si-arena/game-snake/game";
import type {
  SnakeAction,
  SnakeObservation,
  SnakeState,
  SnakeTickInput,
} from "@si-arena/game-snake/sdk";
import { IDS, init, required } from "./helpers";

type CreateGame = (
  observation: unknown,
  channel: { submit(action: SnakeAction): void; reject(message: string): never },
) => SnakeTickInput["game"];
type Tick = (input: { game: SnakeTickInput["game"]; Memory: JsonObject }) => void;

let directory = "";
let createGame: CreateGame;
let officialTick: Tick;

// The trusted SDK and official bot run in-process here to replay whole matches quickly;
// the sandbox test below runs the same bot exactly as the platform does.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "snake-sdk-"));
  const sdk = join(directory, "sdk.mjs");
  await writeFile(sdk, SNAKE_SDK_SOURCE);
  createGame = ((await import(pathToFileURL(sdk).href)) as { default: CreateGame }).default;
  officialTick = ((await import(officialBotUrl.href)) as { default: Tick }).default;
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function inProcess(
  matchId: string,
  playerId: string,
): PlayerExecutor<SnakeObservation, SnakeAction> {
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

const participants = (count: number) =>
  IDS.slice(0, count).map((id, slot) => ({ id, slot, name: id, official: true }));

for (const count of [2, 4]) {
  test(`${count} official bots play a full match that replays to the same result`, async () => {
    const sink = new MemoryReplaySink<SnakeState, SnakeAction>();
    const matchId = `snake-${count}`;
    const played = await runMatch({
      matchId,
      game: snakeGame,
      players: participants(count),
      seed: 7,
      sink,
      async createExecutor(player) {
        return inProcess(matchId, player.id);
      },
    });
    expect(played.result.players).toHaveLength(count);
    expect(played.result.players.some((player) => player.rank === 1)).toBe(true);
    // Official bots eat and grow, so the winner is longer than at spawn.
    expect(["elimination", "tick-limit"]).toContain(played.result.reason);
    expect(Math.max(...played.result.players.map((player) => player.score))).toBeGreaterThan(3);
    expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
    expect(sink.replay.initialState).toStrictEqual(init(count, 7));
    const replayed = await replayMatch(JSON.parse(JSON.stringify(sink.replay)), snakeGame);
    expect(replayed).toStrictEqual(played);
  }, 60000);
}

test("four official bots play a full match in the real sandbox without errors", async () => {
  const source = await readFile(officialBotUrl, "utf8");
  // CPU bills real thread time, so the strict release cpuMs passes on a fast
  // core while shared CI runners several times slower turn the bot's rare GC
  // spikes into CPU_LIMIT overruns. The whole match — engine budget checks,
  // executor limits and the replay's fixed-release comparison — runs on this
  // one relaxed-cpuMs copy so every party agrees; all else stays at release.
  const relaxedGame: typeof snakeGame = {
    ...snakeGame,
    manifest: {
      ...snakeGame.manifest,
      resolvedLimits: resolveResourceLimits({
        ...snakeGame.manifest.resolvedLimits,
        cpuMs: 200,
      }),
    },
  };
  const sink = new MemoryReplaySink<SnakeState, SnakeAction>();
  const played = await runMatch({
    matchId: "snake-sandbox",
    game: relaxedGame,
    players: participants(4),
    seed: 3,
    sink,
    async createExecutor(player, context) {
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source,
        sdkSource: SNAKE_SDK_SOURCE,
        parseAction: snakeGame.rules.parseAction,
        defaultAction: { type: "move", direction: "right" },
      });
    },
  });
  expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
  expect(played.result.players.some((player) => player.rank === 1)).toBe(true);
  expect(played.result.completedTicks).toBeGreaterThan(10);
  expect(await replayMatch(sink.replay, relaxedGame)).toStrictEqual(played);
}, 120000);

test("the SDK exposes basic commands and frozen public facts only", async () => {
  const state = init(3);
  const player = await SandboxPlayer.create({
    matchId: "snake-api",
    playerId: "beta",
    limits: resolveResourceLimits({ cpuMs: 100 }),
    sdkSource: SNAKE_SDK_SOURCE,
    defaultAction: { type: "move", direction: "right" },
    parseAction: snakeGame.rules.parseAction,
    source: `export default ({game,Memory})=>{
      Memory.before=game.self.head.x;
      game.self.move('up');game.self.move('down');
      Memory.after=game.self.head.x;
      Memory.self=[game.self.id,game.self.slot,game.self.length,game.self.health,game.self.heading];
      Memory.opponents=game.opponents.map((p)=>p.id);
      Memory.methods=Object.keys(game.self).filter((k)=>typeof game.self[k]==='function');
      Memory.food=game.food.length;
      Memory.views=[game.tick,game.maxTicks,game.eliminated.length,game.events.length,game.board.width];
      Memory.frozen=Object.isFrozen(game.self.body)&&Object.isFrozen(game.opponents)&&Object.isFrozen(game.food)&&Object.isFrozen(game.self.head);
      Memory.hidden=['rngState','snakes','safeMoves','path'].every((k)=>!(k in game));
    }`,
  });
  try {
    const result = await player.execute(0, required(snakeGame.rules.observe(state, "beta")));
    const spawn = state.snakes[1]!.body[0]!;
    expect(result).toMatchObject({
      ok: true,
      action: { type: "move", direction: "down" },
      memory: {
        before: spawn.x,
        after: spawn.x,
        self: ["beta", 1, 3, 100, state.snakes[1]!.heading],
        opponents: ["alpha", "gamma"],
        methods: ["move"],
        food: 4,
        views: [0, 500, 0, 0, 17],
        frozen: true,
        hidden: true,
      },
    });
    const invalid = await SandboxPlayer.create({
      matchId: "snake-api",
      playerId: "beta",
      limits: resolveResourceLimits({ cpuMs: 100 }),
      sdkSource: SNAKE_SDK_SOURCE,
      defaultAction: { type: "move", direction: "right" },
      parseAction: snakeGame.rules.parseAction,
      source: `export default ({game})=>{try{game.self.move('north')}catch{}game.self.move('up')}`,
    });
    try {
      const failed = await invalid.execute(0, required(snakeGame.rules.observe(state, "beta")));
      expect(failed.ok).toBe(false);
    } finally {
      await invalid.close();
    }
  } finally {
    await player.close();
  }
});
