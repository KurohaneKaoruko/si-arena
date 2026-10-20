// Run from the repository root after pnpm build:packages.
// Research only: no database, ranked matches, or persistent replay files.
import { readFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const localImport = (path) => import(pathToFileURL(resolve(root, path)).href);
const { paperGame, PAPER_SDK_SOURCE, officialBotUrl } = await localImport(
  "games/paper/dist/game.js",
);
const { runMatch, MemoryReplaySink, replayMatch } = await localImport(
  "packages/engine/dist/index.js",
);
const { SandboxPlayer } = await localImport("packages/sandbox/dist/index.js");
const { initializeRuntime, runGuest, GuestSession } = await localImport(
  "packages/sandbox/dist/runtime.js",
);
const { cloneJson } = await localImport("packages/protocol/dist/index.js");
const official = await readFile(officialBotUrl, "utf8");
const idle = "export default ({Memory})=>{Memory.n=(Memory.n??0)+1;return {type:'idle'}}";
const limits = paperGame.manifest.resolvedLimits;
const players = [0, 1].map((slot) => ({ id: `p${slot}`, slot, name: `P${slot}`, official: false }));
const initial = paperGame.rules.init({
  seed: 42,
  config: paperGame.manifest.config,
  players: players.map(({ id, slot }) => ({ id, slot })),
});
const observation = paperGame.rules.observe(initial, "p0");
const summary = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    p50: Math.round(sorted[Math.floor(sorted.length / 2)]),
    p95: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    max: Math.round(sorted.at(-1)),
  };
};
const cpuUs = (start) => {
  const u = process.threadCpuUsage(start);
  return u.user + u.system;
};
if (process.argv.includes("--host-profile")) {
  await runMatch({
    matchId: "profile",
    game: paperGame,
    seed: 42,
    players,
    sink: new MemoryReplaySink(),
    async createExecutor(player, context) {
      return {
        async execute(tick, _observation, action) {
          return {
            matchId: context.matchId,
            playerId: player.id,
            executionId: "trusted-fixture",
            tick,
            ok: true,
            action,
          };
        },
        async close() {},
      };
    },
  });
  process.exit(0);
}
const results = {
  collectedAt: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    cores: cpus().length,
    platform: platform(),
    arch: arch(),
  },
  units:
    "microseconds unless suffixed Bytes; wall includes scheduling; host CPU excludes child CPU",
  observationBytes: Buffer.byteLength(JSON.stringify(observation)),
  sdkBytes: Buffer.byteLength(PAPER_SDK_SOURCE),
  sourceBytes: Buffer.byteLength(official),
  runtimeMode: "match-long QuickJS, reset on failure",
  micro: [],
  matches: [],
};

await initializeRuntime();
for (const [name, source, memory] of [
  ["idle", idle, {}],
  ["official-initial-observation", official, {}],
  ["idle-60KiB-memory", idle, { blob: "x".repeat(60 * 1024) }],
  ["idle-240KiB-source-comments", "/*" + "x".repeat(240 * 1024) + "*/" + idle, {}],
]) {
  const samples = [],
    phases = [],
    failures = {};
  for (let tick = 0; tick < 210; tick++) {
    const start = performance.now();
    const output = runGuest(
      {
        matchId: "research",
        playerId: "p0",
        executionId: "direct",
        tick,
        source,
        observation,
        memory,
        limits,
        captureLogs: false,
      },
      PAPER_SDK_SOURCE,
      0,
      () => {},
      () => {},
    );
    const wall = (performance.now() - start) * 1000;
    const parsed = JSON.parse(output.payload);
    if (!parsed.ok) failures[parsed.error.type] = (failures[parsed.error.type] ?? 0) + 1;
    if (tick >= 10) {
      samples.push(wall);
      phases.push(output.profile);
    }
  }
  results.micro.push({
    name,
    samples: 200,
    directWallUs: summary(samples),
    failures,
    phases: Object.fromEntries(
      Object.keys(phases[0]).map((key) => [key, summary(phases.map((p) => p[key]))]),
    ),
  });
}

// Compare the same trusted wrapper in cold Runtime and match-long Runtime modes.
// This replaces the historical copied-runtime input/serializer experiments.
const lifecycle = { cold: [], persistent: [] };
const session = new GuestSession();
try {
  for (let tick = 0; tick < 310; tick++) {
    for (const name of tick % 2 ? ["persistent", "cold"] : ["cold", "persistent"]) {
      const start = performance.now();
      const input = {
        matchId: "research",
        playerId: "p0",
        executionId: "direct",
        tick,
        source: idle,
        observation,
        memory: {},
        limits,
        captureLogs: false,
      };
      const output =
        name === "cold"
          ? runGuest(
              input,
              PAPER_SDK_SOURCE,
              0,
              () => {},
              () => {},
            )
          : session.execute(
              input,
              PAPER_SDK_SOURCE,
              0,
              () => {},
              () => {},
            );
      if (!JSON.parse(output.payload).ok) throw new Error("Lifecycle experiment failed");
      if (tick >= 10) lifecycle[name].push((performance.now() - start) * 1000);
    }
  }
} finally {
  session.close();
}
results.lifecycleExperiment = Object.fromEntries(
  Object.entries(lifecycle).map(([key, values]) => [key, summary(values)]),
);

// Directly quantify strict clone traversal; built-in JSON roundtrip is a diagnostic lower bound,
// NOT a substitute for the strict JSON boundary (getters/toJSON/hidden properties differ).
results.cloneExperiment = {};
for (const [name, fn] of [
  ["strictClone", () => cloneJson(observation, limits.observationBytes)],
  ["jsonRoundtripLowerBound", () => JSON.parse(JSON.stringify(observation))],
]) {
  const samples = [];
  for (let i = 0; i < 1010; i++) {
    const start = performance.now();
    fn();
    if (i >= 10) samples.push((performance.now() - start) * 1000);
  }
  results.cloneExperiment[name] = summary(samples);
}

for (const name of ["engine-only-idle", "sandbox-idle", "sandbox-official"]) {
  for (let repetition = 0; repetition < 3; repetition++) {
    const sink = new MemoryReplaySink(64 * 1024 * 1024);
    const waits = [],
      startup = [],
      playerCpu = [],
      errors = {};
    const start = performance.now(),
      cpu = process.threadCpuUsage();
    const match = await runMatch({
      matchId: "research",
      game: paperGame,
      players,
      seed: 42,
      captureLogs: false,
      sink,
      async createExecutor(player, context) {
        if (name === "engine-only-idle")
          return {
            async execute(tick, _observation, fallback) {
              return {
                matchId: context.matchId,
                playerId: player.id,
                executionId: "trusted-fixture",
                tick,
                ok: true,
                action: fallback,
              };
            },
            async close() {},
          };
        const begin = performance.now();
        const executor = await SandboxPlayer.create({
          ...context,
          playerId: player.id,
          source: name === "sandbox-official" ? official : idle,
          sdkSource: PAPER_SDK_SOURCE,
          limits,
          isolation: { kind: "local" },
          parseAction: paperGame.rules.parseAction,
          defaultAction: { type: "idle" },
        });
        startup.push((performance.now() - begin) * 1000);
        return {
          async execute(...args) {
            const then = performance.now();
            const output = await executor.execute(...args);
            waits.push((performance.now() - then) * 1000);
            if (output.resources) playerCpu.push(output.resources.cpuUsedUs);
            if (!output.ok) errors[output.error.type] = (errors[output.error.type] ?? 0) + 1;
            return output;
          },
          close: () => executor.close(),
        };
      },
    });
    const wallUs = Math.round((performance.now() - start) * 1000),
      hostCpuUs = cpuUs(cpu);
    const replayStart = performance.now();
    const verified = await replayMatch(sink.replay, paperGame);
    if (verified.finalStateHash !== match.finalStateHash) throw new Error("Replay mismatch");
    const result = {
      name,
      repetition,
      wallUs,
      hostCpuUs,
      replayVerifyWallUs: Math.round((performance.now() - replayStart) * 1000),
      ticks: match.result.completedTicks,
      finalStateHash: match.finalStateHash,
      errors,
      ...(waits.length
        ? {
            executorWallUs: summary(waits),
            startupUs: summary(startup),
            playerCpuUs: summary(playerCpu),
            playerCpuTotalUs: playerCpu.reduce((a, b) => a + b, 0),
          }
        : {}),
    };
    results.matches.push(result);
    process.stderr.write(JSON.stringify(result) + "\n");
  }
}
process.stdout.write(JSON.stringify(results, null, 2) + "\n");
