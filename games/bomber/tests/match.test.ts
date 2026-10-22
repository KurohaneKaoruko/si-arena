import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { cloneJson, resolveResourceLimits, type JsonObject } from "@si-arena/protocol";
import { MemoryReplaySink, replayMatch, runMatch, type PlayerExecutor } from "@si-arena/engine";
import { SandboxPlayer } from "@si-arena/sandbox";
import { officialBotUrl, bomberGame, BOMBER_SDK_SOURCE } from "@si-arena/game-bomber/game";
import type {
  BomberAction,
  BomberObservation,
  BomberState,
  BomberTickInput,
} from "@si-arena/game-bomber/sdk";
import { IDS, init, required } from "./helpers";

type CreateGame = (
  observation: unknown,
  channel: { submit(action: BomberAction): void; reject(message: string): never },
) => BomberTickInput["game"];
type Tick = (input: { game: BomberTickInput["game"]; Memory: JsonObject }) => void;

let directory = "";
let createGame: CreateGame;
let officialTick: Tick;

// The trusted SDK and official bot run in-process here to replay whole matches quickly;
// the sandbox test below runs the same bot exactly as the platform does.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "bomber-sdk-"));
  const sdk = join(directory, "sdk.mjs");
  await writeFile(sdk, BOMBER_SDK_SOURCE);
  createGame = ((await import(pathToFileURL(sdk).href)) as { default: CreateGame }).default;
  officialTick = ((await import(officialBotUrl.href)) as { default: Tick }).default;
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function inProcess(
  matchId: string,
  playerId: string,
): PlayerExecutor<BomberObservation, BomberAction> {
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
    const sink = new MemoryReplaySink<BomberState, BomberAction>();
    const matchId = `bomber-${count}`;
    const played = await runMatch({
      matchId,
      game: bomberGame,
      players: participants(count),
      seed: 7,
      sink,
      async createExecutor(player) {
        return inProcess(matchId, player.id);
      },
    });
    expect(played.result.players).toHaveLength(count);
    expect(played.result.players.some((player) => player.rank === 1)).toBe(true);
    expect(["elimination", "tick-limit"]).toContain(played.result.reason);
    // Official bots blow up walls from the start, so the winner always scores.
    expect(Math.max(...played.result.players.map((player) => player.score))).toBeGreaterThan(0);
    expect(sink.replay.initialState).toStrictEqual(init(count, 7));
    const replayed = await replayMatch(JSON.parse(JSON.stringify(sink.replay)), bomberGame);
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
  const relaxedGame: typeof bomberGame = {
    ...bomberGame,
    manifest: {
      ...bomberGame.manifest,
      resolvedLimits: resolveResourceLimits({
        ...bomberGame.manifest.resolvedLimits,
        cpuMs: 200,
      }),
    },
  };
  const sink = new MemoryReplaySink<BomberState, BomberAction>();
  const played = await runMatch({
    matchId: "bomber-sandbox",
    game: relaxedGame,
    players: participants(4),
    seed: 3,
    sink,
    async createExecutor(player, context) {
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source,
        sdkSource: BOMBER_SDK_SOURCE,
        parseAction: bomberGame.rules.parseAction,
        defaultAction: { type: "idle" },
      });
    },
  });
  expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
  expect(played.result.completedTicks).toBeGreaterThan(0);
  expect(played.result.completedTicks).toBeLessThanOrEqual(400);
  expect(await replayMatch(sink.replay, relaxedGame)).toStrictEqual(played);
}, 120000);

test("the SDK exposes basic commands and frozen public facts only", async () => {
  const state = init(3);
  const player = await SandboxPlayer.create({
    matchId: "bomber-api",
    playerId: "beta",
    limits: resolveResourceLimits({ cpuMs: 100 }),
    sdkSource: BOMBER_SDK_SOURCE,
    defaultAction: { type: "idle" },
    parseAction: bomberGame.rules.parseAction,
    source: `export default ({game,Memory})=>{
      Memory.before=game.self.position.x;
      game.self.move('up');game.self.bomb();game.self.idle();game.self.move('left');
      Memory.after=game.self.position.x;
      Memory.self=[game.self.id,game.self.slot,game.self.bombsMax,game.self.fireRange,game.self.activeBombs,game.self.score];
      Memory.opponents=game.opponents.map((p)=>p.id);
      Memory.methods=Object.keys(game.self).filter((k)=>typeof game.self[k]==='function');
      Memory.collapse=game.collapse;
      Memory.views=[game.tick,game.maxTicks,game.eliminated.length,game.events.length,game.board.width,game.board.height,game.bombs.length,game.powerups.length];
      Memory.frozen=Object.isFrozen(game.board.cells)&&Object.isFrozen(game.opponents)&&Object.isFrozen(game.self.position)&&Object.isFrozen(game.bombs);
      Memory.hidden=['rngState','players','hidden','danger','safeMoves'].every((k)=>!(k in game))&&!('hidden' in game.board);
    }`,
  });
  try {
    const result = await player.execute(0, required(bomberGame.rules.observe(state, "beta")));
    const spawn = state.players[1]!.position!;
    expect(result).toMatchObject({
      ok: true,
      action: { type: "move", direction: "left" },
      memory: {
        before: spawn.x,
        after: spawn.x,
        self: ["beta", 1, 1, 2, 0, 0],
        opponents: ["alpha", "gamma"],
        methods: ["move", "bomb", "idle"],
        collapse: { startTick: 300, interval: 8, nextRing: 0, ticksToNextCollapse: 300 },
        views: [0, 400, 0, 0, 15, 13, 0, 0],
        frozen: true,
        hidden: true,
      },
    });
  } finally {
    await player.close();
  }
});
