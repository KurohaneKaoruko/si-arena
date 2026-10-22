import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { paperGame, officialBotUrl } from "@si-arena/game-paper/game";
import { runMatchProcess } from "@si-arena/runner";
import { replayMatch } from "@si-arena/engine";
import { readReplayFile } from "@si-arena/engine/node";

const { values } = parseArgs({
  options: { seed: { type: "string", default: "42" }, out: { type: "string" } },
});
const matchId = `local-${randomUUID()}`;
const path = resolve(values.out ?? join(tmpdir(), `${matchId}.json.gz`));
const source = await readFile(officialBotUrl, "utf8");
const cancellation = new AbortController();
const stop = () => cancellation.abort();
process.once("SIGINT", stop);
try {
  const summary = await runMatchProcess({
    matchId,
    module: {
      url: import.meta.resolve("@si-arena/game-paper/game"),
      gameExport: "paperGame",
      sdkSourceExport: "PAPER_SDK_SOURCE",
    },
    manifest: paperGame.manifest,
    isolation: { kind: "local" },
    sources: [source, "export default ()=>{}"],
    replayPath: path,
    seed: Number(values.seed),
    captureLogs: true,
    signal: cancellation.signal,
    players: [
      { id: "official", slot: 0, name: "Official", official: true },
      { id: "idle", slot: 1, name: "Idle", official: false },
    ],
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
