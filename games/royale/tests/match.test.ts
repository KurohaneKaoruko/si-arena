import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { cloneJson, resolveResourceLimits, type JsonObject } from "@si-arena/protocol";
import { MemoryReplaySink, replayMatch, runMatch, type PlayerExecutor } from "@si-arena/engine";
import { SandboxPlayer } from "@si-arena/sandbox";
import { officialBotUrl, royaleGame, ROYALE_SDK_SOURCE } from "@si-arena/game-royale/game";
import type {
  RoyaleAction,
  RoyaleObservation,
  RoyaleState,
  RoyaleTickInput,
} from "@si-arena/game-royale/sdk";
import { IDS, init, required } from "./helpers";

type CreateGame = (
  observation: unknown,
  channel: { submit(action: RoyaleAction): void; reject(message: string): never },
) => RoyaleTickInput["game"];
type Tick = (input: { game: RoyaleTickInput["game"]; Memory: JsonObject }) => void;

let directory = "";
let createGame: CreateGame;
let officialTick: Tick;

// The trusted SDK and official bot run in-process here to replay whole matches quickly;
// the sandbox test below runs the same bot exactly as the platform does.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "royale-sdk-"));
  const sdk = join(directory, "sdk.mjs");
  await writeFile(sdk, ROYALE_SDK_SOURCE);
  createGame = ((await import(pathToFileURL(sdk).href)) as { default: CreateGame }).default;
  officialTick = ((await import(officialBotUrl.href)) as { default: Tick }).default;
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function inProcess(
  matchId: string,
  playerId: string,
): PlayerExecutor<RoyaleObservation, RoyaleAction> {
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

for (const count of [2, 5]) {
  test(`${count} official bots play a full match that replays to the same result`, async () => {
    const sink = new MemoryReplaySink<RoyaleState, RoyaleAction>();
    const matchId = `royale-${count}`;
    const played = await runMatch({
      matchId,
      game: royaleGame,
      players: participants(count),
      seed: 7,
      sink,
      async createExecutor(player) {
        return inProcess(matchId, player.id);
      },
    });
    expect(played.result.players).toHaveLength(count);
    expect(played.result.players.some((player) => player.rank === 1)).toBe(true);
    // Official bots never die by their own mistakes, so with no aggressor they all reach the limit.
    expect(played.result).toMatchObject({ reason: "tick-limit", completedTicks: 800 });
    for (const player of played.result.players) expect(player.score).toBeGreaterThan(9);
    expect(sink.replay.initialState).toStrictEqual(init(count, 7));
    const replayed = await replayMatch(JSON.parse(JSON.stringify(sink.replay)), royaleGame);
    expect(replayed).toStrictEqual(played);
  }, 60000);
}

test("five official bots play a full match in the real sandbox without errors", async () => {
  const source = await readFile(officialBotUrl, "utf8");
  // CPU bills real thread time, so the strict release cpuMs passes on a fast
  // core while shared CI runners several times slower turn the bot's rare GC
  // spikes into CPU_LIMIT overruns. The whole match — engine budget checks,
  // executor limits and the replay's fixed-release comparison — runs on this
  // one relaxed-cpuMs copy so every party agrees; all else stays at release.
  const relaxedGame: typeof royaleGame = {
    ...royaleGame,
    manifest: {
      ...royaleGame.manifest,
      resolvedLimits: resolveResourceLimits({
        ...royaleGame.manifest.resolvedLimits,
        cpuMs: 200,
      }),
    },
  };
  const sink = new MemoryReplaySink<RoyaleState, RoyaleAction>();
  const played = await runMatch({
    matchId: "royale-sandbox",
    game: relaxedGame,
    players: participants(5),
    seed: 3,
    sink,
    async createExecutor(player, context) {
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source,
        sdkSource: ROYALE_SDK_SOURCE,
        parseAction: royaleGame.rules.parseAction,
        defaultAction: { type: "idle" },
      });
    },
  });
  expect(sink.replay.ticks.flatMap((tick) => Object.values(tick.errors ?? {}))).toStrictEqual([]);
  expect(played.result.completedTicks).toBe(800);
  expect(await replayMatch(sink.replay, relaxedGame)).toStrictEqual(played);
}, 120000);

test("the SDK exposes basic commands and frozen public facts only", async () => {
  const state = init(3);
  const player = await SandboxPlayer.create({
    matchId: "royale-api",
    playerId: "beta",
    limits: resolveResourceLimits({ cpuMs: 100 }),
    sdkSource: ROYALE_SDK_SOURCE,
    defaultAction: { type: "idle" },
    parseAction: royaleGame.rules.parseAction,
    source: `export default ({game,Memory})=>{
      Memory.before=game.self.position.x;
      game.self.move('up');game.self.idle();game.self.move('left');
      Memory.after=game.self.position.x;
      Memory.self=[game.self.id,game.self.slot,game.self.area];
      Memory.opponents=game.opponents.map((p)=>p.id);
      Memory.methods=Object.keys(game.self).filter((k)=>typeof game.self[k]==='function');
      Memory.zone=game.zone;
      Memory.views=[game.tick,game.maxTicks,game.eliminated.length,game.events.length,game.board.width];
      Memory.frozen=Object.isFrozen(game.board.territory)&&Object.isFrozen(game.opponents)&&Object.isFrozen(game.self.position);
      Memory.hidden=['rngState','players','homePath','safeMoves'].every((k)=>!(k in game));
    }`,
  });
  try {
    const result = await player.execute(0, required(royaleGame.rules.observe(state, "beta")));
    const spawn = state.players[1]!.spawn;
    expect(result).toMatchObject({
      ok: true,
      action: { type: "move", direction: "left" },
      memory: {
        before: spawn.x,
        after: spawn.x,
        self: ["beta", 1, 9],
        opponents: ["alpha", "gamma"],
        methods: ["move", "idle"],
        zone: { size: 31, target: 31, min: { x: 0, y: 0 }, ticksToNextShrink: null },
        views: [0, 800, 0, 0, 31],
        frozen: true,
        hidden: true,
      },
    });
  } finally {
    await player.close();
  }
});
