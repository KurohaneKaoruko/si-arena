// Isolated package graphs compare the previous persistent VM against the same VM
// with direct JSON cloning, validated immutable-grid caching and bound character access.
import { readFile, writeFile, mkdir, mkdtemp, symlink, rm, cp, realpath } from "node:fs/promises";
import { tmpdir, cpus, platform, arch } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import ts from "typescript";

const root = process.cwd();
const originalRef = "af8bab107f3d58107541b3c713027d8ecb923d8d";
const { values } = parseArgs({ options: { pairs: { type: "string", default: "6" } } });
const count = Number(values.pairs);
if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Invalid --pairs");
const temporary = await mkdtemp(join(tmpdir(), "arena-data-paired-"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const digest = (text) => createHash("sha256").update(text).digest("hex");
const median = (samples) => {
  const sorted = samples.toSorted((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
};
const results = {
  collectedAt: new Date().toISOString(),
  revision: git("rev-parse", "HEAD").trim(),
  originalDataHelpersRef: originalRef,
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    cores: cpus().length,
    platform: platform(),
    arch: arch(),
  },
  units: "microseconds unless explicitly named otherwise",
  methodology: `Both modes use current persistent VM, identical frozen budgets, engine, SDK, bot and WASM. Separate package graphs prevent workspace imports from leaking between modes. Both overlay modules are transpiled identically; before restores original protocol JSON and Paper grid parsers plus previous character access, after uses current helpers. One full warm-up per mode excluded. ${count} paired seeds, alternating order, serial matches with two parallel players. Timed match includes startup, 600 ticks, rules, gzip+fsync and shutdown; verification separate. No database, queue wait, upload validation or rendering.`,
  sources: {},
  warmups: [],
  pairs: [],
  memory: {},
};

async function implementation(mode) {
  const directory = join(temporary, mode);
  for (const dir of ["packages/protocol", "packages/engine", "packages/sandbox", "games/paper"]) {
    const source = resolve(root, dir);
    const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    const destination = join(directory, "node_modules", pkg.name);
    await mkdir(destination, { recursive: true });
    await cp(join(source, "dist"), join(destination, "dist"), { recursive: true });
    await cp(join(source, "package.json"), join(destination, "package.json"));
    if (dir === "packages/sandbox")
      await cp(join(source, "runtime"), join(destination, "runtime"), { recursive: true });
    if (dir === "games/paper")
      await cp(join(source, "bots"), join(destination, "bots"), { recursive: true });
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
      if (name.startsWith("@si-arena/")) continue;
      const link = join(destination, "node_modules", name);
      await mkdir(dirname(link), { recursive: true });
      await symlink(await realpath(join(source, "node_modules", name)), link);
    }
  }
  results.sources[mode] = {};
  for (const [path, target] of [
    ["packages/protocol/src/json-data.ts", "@si-arena/protocol/dist/json-data.js"],
    ["games/paper/src/rules/state.ts", "@si-arena/game-paper/dist/rules/state.js"],
    ["packages/sandbox/src/bootstrap.ts", "@si-arena/sandbox/dist/bootstrap.js"],
  ]) {
    let text = await readFile(resolve(root, path), "utf8");
    if (mode === "before" && !path.endsWith("bootstrap.ts"))
      text = git("show", `${originalRef}:${path}`);
    if (mode === "before" && path.endsWith("bootstrap.ts")) {
      if (
        !text.includes(
          "const charCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt);",
        )
      )
        throw new Error("Bootstrap shape changed");
      text = text
        .replace(
          "const charCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt);",
          "const charCodeAt = String.prototype.charCodeAt;",
        )
        .replaceAll(/charCodeAt\(text, ([^)]+)\)/g, "apply(charCodeAt, text, [$1])");
    }
    results.sources[mode][path] = digest(text);
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
        (_all, prefix, file, suffix) =>
          prefix + (/\.[cm]?js$/.test(file) ? file : file + ".js") + suffix,
      );
    await writeFile(join(directory, "node_modules", target), compiled);
  }
  const load = (path) => import(pathToFileURL(join(directory, "node_modules", path)).href);
  return {
    ...(await load("@si-arena/engine/dist/index.js")),
    ...(await load("@si-arena/engine/dist/node/index.js")),
    ...(await load("@si-arena/sandbox/dist/index.js")),
    ...(await load("@si-arena/game-paper/dist/game.js")),
    ...(await load("@si-arena/protocol/dist/index.js")),
  };
}

async function match(impl, mode, seed, name) {
  const path = join(temporary, `${name}-${mode}.json.gz`);
  const source = await readFile(impl.officialBotUrl, "utf8");
  const start = performance.now();
  const played = await impl.runMatch({
    matchId: "paired-data",
    game: impl.paperGame,
    seed,
    captureLogs: false,
    sink: new impl.ReplayFileSink(path),
    players: [0, 1].map((slot) => ({ id: `p${slot}`, slot, name: `P${slot}`, official: true })),
    async createExecutor(player, context) {
      return impl.SandboxPlayer.create({
        ...context,
        playerId: player.id,
        source,
        sdkSource: impl.PAPER_SDK_SOURCE,
        isolation: { kind: "local" },
        parseAction: impl.paperGame.rules.parseAction,
        defaultAction: { type: "idle" },
      });
    },
  });
  const wallUs = Math.round((performance.now() - start) * 1000);
  const verifyStart = performance.now();
  const replay = await impl.readReplayFile(path);
  const verified = await impl.replayMatch(replay, impl.paperGame);
  if (verified.finalStateHash !== played.finalStateHash) throw new Error("Replay mismatch");
  const errors = {};
  for (const tick of replay.ticks)
    for (const error of Object.values(tick.errors ?? {}))
      errors[error.type] = (errors[error.type] ?? 0) + 1;
  const result = {
    mode,
    seed,
    wallUs,
    verifyWallUs: Math.round((performance.now() - verifyStart) * 1000),
    ticks: played.result.completedTicks,
    errors,
    finalStateHash: played.finalStateHash,
    actionsSha256: digest(
      impl.stringifyJson(replay.ticks.map(({ tick, actions }) => ({ tick, actions }))),
    ),
  };
  process.stderr.write(JSON.stringify({ name, ...result }) + "\n");
  return result;
}

async function memory(impl) {
  const player = await impl.SandboxPlayer.create({
    matchId: "memory",
    playerId: "p0",
    limits: impl.paperGame.manifest.resolvedLimits,
    source:
      "export default ({Memory})=>{Memory.blob??='x'.repeat(60*1024);Memory.n=(Memory.n??0)+1;return {type:'idle'}}",
    sdkSource: impl.PAPER_SDK_SOURCE,
    isolation: { kind: "local" },
    parseAction: impl.paperGame.rules.parseAction,
    defaultAction: { type: "idle" },
  });
  const samples = [];
  try {
    for (let tick = 0; tick < 105; tick++) {
      const start = performance.now();
      const output = await player.execute(tick, {});
      if (!output.ok) throw new Error("Memory probe failed: " + JSON.stringify(output.error));
      if (tick >= 5) samples.push((performance.now() - start) * 1000);
    }
  } finally {
    await player.close();
  }
  return {
    meanWallUs: samples.reduce((a, b) => a + b, 0) / samples.length,
    medianWallUs: median(samples),
  };
}

try {
  const modes = { before: await implementation("before"), after: await implementation("after") };
  results.game = {
    release: modes.after.paperGame.manifest.release,
    botProtocolVersion: modes.after.paperGame.manifest.botProtocolVersion,
    limits: modes.after.paperGame.manifest.resolvedLimits,
  };
  results.wasm = JSON.parse(
    await readFile(resolve(root, "packages/sandbox/runtime/build.json"), "utf8"),
  );
  for (const mode of ["before", "after"])
    results.warmups.push(await match(modes[mode], mode, 41, "warmup"));
  for (let index = 0; index < count; index++) {
    const order = index % 2 ? ["after", "before"] : ["before", "after"];
    const pair = { seed: 42 + index, order };
    for (const mode of order)
      pair[mode] = await match(modes[mode], mode, pair.seed, `pair-${index}`);
    pair.identicalActions = pair.before.actionsSha256 === pair.after.actionsSha256;
    pair.identicalState = pair.before.finalStateHash === pair.after.finalStateHash;
    pair.zeroErrors =
      Object.keys(pair.before.errors).length === 0 && Object.keys(pair.after.errors).length === 0;
    pair.reductionPercent = 100 * (1 - pair.after.wallUs / pair.before.wallUs);
    results.pairs.push(pair);
  }
  for (const mode of ["before", "after"]) results.memory[mode] = await memory(modes[mode]);
  const before = results.pairs.reduce((n, p) => n + p.before.wallUs, 0);
  const after = results.pairs.reduce((n, p) => n + p.after.wallUs, 0);
  const total = (mode) =>
    results.pairs.reduce((n, p) => n + p[mode].wallUs + p[mode].verifyWallUs, 0);
  results.summary = {
    beforeMeanWallUs: before / count,
    afterMeanWallUs: after / count,
    reductionPercent: 100 * (1 - after / before),
    speedup: before / after,
    withVerificationReductionPercent: 100 * (1 - total("after") / total("before")),
    medianPairedReductionPercent: median(results.pairs.map((p) => p.reductionPercent)),
    allIdenticalActions: results.pairs.every((p) => p.identicalActions),
    allIdenticalStates: results.pairs.every((p) => p.identicalState),
    allZeroErrors: results.pairs.every((p) => p.zeroErrors),
    memoryReductionPercent:
      100 * (1 - results.memory.after.meanWallUs / results.memory.before.meanWallUs),
  };
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
