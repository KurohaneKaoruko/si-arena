// Run from the repository root after pnpm build:packages.
// Compile both sandbox implementations identically into a temporary directory.
// Player code still runs exclusively in their isolated QuickJS child processes.
import { readFile, writeFile, mkdir, mkdtemp, symlink, rm, readdir } from "node:fs/promises";
import { tmpdir, cpus, platform, arch } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import ts from "typescript";
import { runMatch, replayMatch } from "@si-arena/engine";
import { ReplayFileSink, readReplayFile } from "@si-arena/engine/node";
import { paperGame, officialBotUrl, PAPER_SDK_SOURCE } from "@si-arena/game-paper/game";
import { stringifyJson } from "@si-arena/protocol";

const root = process.cwd();
const baselineRevision = "af8bab107f3d58107541b3c713027d8ecb923d8d";
const { values } = parseArgs({ options: { pairs: { type: "string", default: "6" } } });
const pairCount = Number(values.pairs);
if (!Number.isInteger(pairCount) || pairCount < 1 || pairCount > 20)
  throw new Error("--pairs must be an integer from 1 to 20");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const temporary = await mkdtemp(join(tmpdir(), "si-arena-paired-execution-"));
const source = await readFile(officialBotUrl, "utf8");
const players = [0, 1].map((slot) => ({ id: `p${slot}`, slot, name: `P${slot}`, official: true }));
const results = {
  collectedAt: new Date().toISOString(),
  baselineRevision,
  currentRevision: git("rev-parse", "HEAD").trim(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    cores: cpus().length,
    platform: platform(),
    arch: arch(),
  },
  units: "microseconds unless explicitly named otherwise",
  game: {
    release: paperGame.manifest.release,
    botProtocolVersion: paperGame.manifest.botProtocolVersion,
    limits: paperGame.manifest.resolvedLimits,
  },
  sdkSha256: createHash("sha256").update(PAPER_SDK_SOURCE).digest("hex"),
  botSha256: createHash("sha256").update(source).digest("hex"),
  wasm: JSON.parse(await readFile(resolve(root, "packages/sandbox/runtime/build.json"), "utf8")),
  sandboxSourceSha256: {},
  methodology:
    "Exact old and working-tree sandbox TS sources transpiled with identical TypeScript settings; common current engine/rules/bot/SDK/WASM/limits. Both players run in parallel, matches sequential. Timed interval includes both process startups, all 600 ticks, rules, gzip replay write+fsync, and player shutdown. Replay read/verification occurs afterward. One full warm-up match per mode excluded; pair order alternates old/new and new/old. No database, queue wait, upload validation, or browser rendering.",
  warmups: [],
  pairs: [],
};

async function sandbox(mode) {
  const directory = join(temporary, mode);
  await mkdir(join(directory, "dist"), { recursive: true });
  await writeFile(join(directory, "package.json"), '{"type":"module"}');
  await symlink(resolve(root, "packages/sandbox/node_modules"), join(directory, "node_modules"));
  await symlink(resolve(root, "packages/sandbox/runtime"), join(directory, "runtime"));
  const paths =
    mode === "old"
      ? git("ls-tree", "-r", "--name-only", baselineRevision, "packages/sandbox/src")
          .trim()
          .split("\n")
      : (await readdir(resolve(root, "packages/sandbox/src"))).map(
          (name) => `packages/sandbox/src/${name}`,
        );
  const digest = createHash("sha256");
  for (const path of paths.filter((p) => p.endsWith(".ts")).toSorted()) {
    const text =
      mode === "old"
        ? git("show", `${baselineRevision}:${path}`)
        : await readFile(resolve(root, path), "utf8");
    digest.update(path).update("\0").update(text).update("\0");
    const compiled = ts
      .transpileModule(text, {
        fileName: path,
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ESNext,
          verbatimModuleSyntax: true,
        },
      })
      .outputText.replace(
        /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
        (_all, prefix, target, suffix) =>
          prefix + (/\.[cm]?js$/.test(target) ? target : target + ".js") + suffix,
      );
    await writeFile(
      join(directory, "dist", path.split("/").at(-1).replace(/\.ts$/, ".js")),
      compiled,
    );
  }
  results.sandboxSourceSha256[mode] = digest.digest("hex");
  return import(pathToFileURL(join(directory, "dist/index.js")).href);
}

async function match(mode, seed, name, SandboxPlayer) {
  const replayPath = join(temporary, `${name}-${mode}.json.gz`);
  const sink = new ReplayFileSink(replayPath);
  const start = performance.now();
  const summary = await runMatch({
    matchId: "paired-benchmark",
    game: paperGame,
    seed,
    players,
    captureLogs: false,
    sink,
    async createExecutor(player, context) {
      return SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source,
        sdkSource: PAPER_SDK_SOURCE,
        isolation: { kind: "local" },
        parseAction: paperGame.rules.parseAction,
        defaultAction: { type: "idle" },
      });
    },
  });
  const wallUs = Math.round((performance.now() - start) * 1000);
  const verifyStart = performance.now();
  const replay = await readReplayFile(replayPath);
  const verified = await replayMatch(replay, paperGame);
  if (verified.finalStateHash !== summary.finalStateHash)
    throw new Error("Replay verification failed");
  const errors = {};
  let playerCpuTotalUs = 0;
  for (const record of replay.ticks) {
    for (const error of Object.values(record.errors ?? {}))
      errors[error.type] = (errors[error.type] ?? 0) + 1;
    for (const resources of Object.values(record.resources ?? {}))
      playerCpuTotalUs += resources.cpuUsedUs ?? 0;
  }
  const result = {
    mode,
    seed,
    wallUs,
    verifyWallUs: Math.round((performance.now() - verifyStart) * 1000),
    playerCpuTotalUs,
    ticks: summary.result.completedTicks,
    errors,
    finalStateHash: summary.finalStateHash,
    actionsSha256: createHash("sha256")
      .update(stringifyJson(replay.ticks.map(({ tick, actions }) => ({ tick, actions }))))
      .digest("hex"),
  };
  process.stderr.write(JSON.stringify({ name, ...result }) + "\n");
  return result;
}

const median = (samples) => {
  const sorted = samples.toSorted((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
};

try {
  const implementations = { old: await sandbox("old"), current: await sandbox("current") };
  for (const mode of ["old", "current"])
    results.warmups.push(await match(mode, 41, "warmup", implementations[mode].SandboxPlayer));
  for (let index = 0; index < pairCount; index++) {
    const seed = 42 + index;
    const order = index % 2 ? ["current", "old"] : ["old", "current"];
    const pair = { index, seed, order };
    for (const mode of order)
      pair[mode] = await match(mode, seed, `pair-${index}`, implementations[mode].SandboxPlayer);
    pair.identicalActions = pair.old.actionsSha256 === pair.current.actionsSha256;
    pair.identicalFinalState = pair.old.finalStateHash === pair.current.finalStateHash;
    pair.zeroErrors =
      Object.keys(pair.old.errors).length === 0 && Object.keys(pair.current.errors).length === 0;
    pair.reductionPercent = 100 * (1 - pair.current.wallUs / pair.old.wallUs);
    results.pairs.push(pair);
  }
  const oldUs = results.pairs.reduce((total, pair) => total + pair.old.wallUs, 0);
  const currentUs = results.pairs.reduce((total, pair) => total + pair.current.wallUs, 0);
  results.summary = {
    measuredMatches: results.pairs.length * 2,
    oldMeanWallUs: oldUs / pairCount,
    currentMeanWallUs: currentUs / pairCount,
    oldMedianWallUs: median(results.pairs.map((pair) => pair.old.wallUs)),
    currentMedianWallUs: median(results.pairs.map((pair) => pair.current.wallUs)),
    aggregateReductionPercent: 100 * (1 - currentUs / oldUs),
    pairedMedianReductionPercent: median(results.pairs.map((pair) => pair.reductionPercent)),
    speedup: oldUs / currentUs,
    allIdenticalActions: results.pairs.every((pair) => pair.identicalActions),
    allIdenticalFinalStates: results.pairs.every((pair) => pair.identicalFinalState),
    allZeroErrors: results.pairs.every((pair) => pair.zeroErrors),
  };
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
