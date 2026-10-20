import { MemoryReplaySink, runMatch } from "@si-arena/engine";
import { paperGame } from "@si-arena/game-paper/game";
import type { PaperAction, PaperState } from "@si-arena/game-paper/sdk";

async function buildFixture() {
  const sink = new MemoryReplaySink<PaperState, PaperAction>();
  await runMatch({
    game: paperGame,
    sink,
    matchId: "web-replay",
    seed: 2,
    captureLogs: true,
    players: [
      { id: "constructor", slot: 0, name: "<script>alert(1)</script>", official: false },
      { id: "other", slot: 1, name: "Official", official: true },
    ],
    async createExecutor(player) {
      return {
        async execute(tick) {
          const fails = tick === 0 && player.slot === 1;
          const action: PaperAction =
            player.slot === 0 ? { type: "move", direction: "left" } : { type: "idle" };
          return {
            matchId: "web-replay",
            executionId: "web-test",
            playerId: player.id,
            tick,
            ok: !fails,
            action,
            ...(fails
              ? { error: { type: "RUNTIME_ERROR" as const, message: "test failure" } }
              : {}),
            logs: [
              { level: "log" as const, message: "<img src=x onerror=alert(1)>" },
              { level: "warn" as const, message: "watch the trail" },
            ],
            resources: { cpuUsedUs: 1234 },
          };
        },
        async close() {},
      };
    },
  });
  return sink.replay;
}

// A Paper match always runs to the tick limit, so the fixture is built once
// per test file and shared by the tests that only read it.
let fixture: ReturnType<typeof buildFixture> | undefined;
export function replayFixture() {
  fixture ??= buildFixture();
  return fixture;
}
