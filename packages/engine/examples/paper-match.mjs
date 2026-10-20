import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { paperGame, officialBotUrl, PAPER_SDK_SOURCE } from "@si-arena/game-paper/game";
import { MatchLogBudget, SandboxPlayer } from "@si-arena/sandbox";
import { replayMatch, runMatch } from "@si-arena/engine";
import { ReplayFileSink, readReplayFile } from "@si-arena/engine/node";

const { values } = parseArgs({
  options: { seed: { type: "string", default: "42" }, out: { type: "string" } },
});
const matchId = `local-${randomUUID()}`;
const path = resolve(values.out ?? join(tmpdir(), `${matchId}.json.gz`));
const source = await readFile(officialBotUrl, "utf8");
const logBudget = new MatchLogBudget(paperGame.manifest.resolvedLimits.logs.matchBytes);
const cancellation = new AbortController();
const stop = () => cancellation.abort();
process.once("SIGINT", stop);
try {
  const summary = await runMatch({
    matchId,
    game: paperGame,
    seed: Number(values.seed),
    captureLogs: true,
    signal: cancellation.signal,
    players: [
      { id: "official", slot: 0, name: "Official", official: true },
      { id: "idle", slot: 1, name: "Idle", official: false },
    ],
    sink: new ReplayFileSink(path),
    async createExecutor(player, context) {
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source: player.official ? source : `export default ()=>{}`,
        sdkSource: PAPER_SDK_SOURCE,
        isolation: { kind: "local" },
        parseAction: paperGame.rules.parseAction,
        defaultAction: { type: "idle" },
        logBudget,
      });
    },
  });
  const replay = await readReplayFile(path);
  const verified = await replayMatch(replay, paperGame);
  if (verified.finalStateHash !== summary.finalStateHash)
    throw new Error("Replay verification failed");
  console.log(
    JSON.stringify(
      {
        matchId,
        release: paperGame.manifest.release,
        result: summary.result,
        replay: path,
        finalStateHash: summary.finalStateHash,
        verified: true,
      },
      null,
      2,
    ),
  );
} finally {
  process.removeListener("SIGINT", stop);
}
