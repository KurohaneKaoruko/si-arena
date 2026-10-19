import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { x as extract } from "tar";

interface Manifest {
  name: string;
  version: string;
  exports: Record<string, { import: string; types: string }>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const pnpmPath = process.env.npm_execpath;
if (!pnpmPath) throw new Error("Run this check with pnpm test:artifacts");
const pnpmIsScript = /\.[cm]?js$/.test(pnpmPath);
const runPnpm = (args: string[]) =>
  execFileSync(
    pnpmIsScript ? process.execPath : pnpmPath,
    pnpmIsScript ? [pnpmPath, ...args] : args,
    { cwd: root, encoding: "utf8", stdio: "pipe", timeout: 60_000 },
  );
// These child processes intentionally have no TypeScript loader or test aliases.
const nodeOptions = { ...process.env, NODE_OPTIONS: "" };
const runNode = (args: string[], cwd: string) =>
  execFileSync(process.execPath, args, {
    cwd,
    env: nodeOptions,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 30_000,
  });

const temporary = await mkdtemp(join(tmpdir(), "si-arena-artifacts-"));
try {
  const packs = join(temporary, "packs");
  await mkdir(packs);
  runPnpm([
    "--filter",
    "./packages/**",
    // @si-arena/db is a private workspace-only package; only distributed
    // packages belong in the packed-artifact verification.
    "--filter",
    "!./packages/db",
    "--filter",
    "./games/**",
    "-r",
    "--workspace-concurrency=1",
    "pack",
    "--pack-destination",
    packs,
  ]);
  const entries: string[] = [];
  const externalDependencies: Record<string, string> = {};
  const archives = (await readdir(packs)).filter((file) => file.endsWith(".tgz"));
  assert.ok(archives.length > 0, "No public workspace packages were packed");
  let cliDirectory: string | undefined;
  for (const [index, archive] of archives.entries()) {
    const unpack = join(temporary, "unpack", String(index));
    await mkdir(unpack, { recursive: true });
    await extract({ file: join(packs, archive), cwd: unpack, strict: true });
    const packageDirectory = join(unpack, "package");
    const manifest = JSON.parse(
      await readFile(join(packageDirectory, "package.json"), "utf8"),
    ) as Manifest;
    for (const version of Object.values(manifest.dependencies ?? {})) {
      assert.ok(
        !version.startsWith("workspace:"),
        "Packed dependencies must not retain workspace links",
      );
    }
    for (const [name, version] of Object.entries({
      ...manifest.peerDependencies,
      ...manifest.dependencies,
    })) {
      if (!name.startsWith("@si-arena/")) externalDependencies[name] = version;
    }
    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      assert.ok(
        existsSync(join(packageDirectory, entry.import)),
        `Missing JS export in ${manifest.name}: ${subpath}`,
      );
      assert.ok(
        existsSync(join(packageDirectory, entry.types)),
        `Missing type export in ${manifest.name}: ${subpath}`,
      );
      entries.push(manifest.name + (subpath === "." ? "" : subpath.slice(1)));
    }
    const target = join(temporary, "node_modules", manifest.name);
    await mkdir(dirname(target), { recursive: true });
    await rename(packageDirectory, target);
    if (manifest.name === "@si-arena/cli") cliDirectory = target;
  }
  const nodeTypes = JSON.parse(
    await readFile(join(root, "node_modules/@types/node/package.json"), "utf8"),
  ) as { version: string };
  externalDependencies["@types/node"] = nodeTypes.version;
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({
      name: "si-arena-artifact-consumer",
      private: true,
      type: "module",
      dependencies: externalDependencies,
    }),
  );
  // Install real declared runtime dependencies, without workspace links or lifecycle scripts.
  runPnpm(["--dir", temporary, "install", "--ignore-scripts", "--no-frozen-lockfile"]);
  const imports = entries
    .map((id, index) => `import * as entry${index} from ${JSON.stringify(id)};`)
    .join("\n");
  const exports = entries.map((_, index) => `entry${index}`).join(", ");
  await writeFile(
    join(temporary, "consumer.ts"),
    `${imports}
export { ${exports} };
import { paperManifest } from "@si-arena/game-paper";
import { paperRules } from "@si-arena/game-paper/rules";
import type { PaperResult } from "@si-arena/game-paper/rules";
import { SandboxPlayer, createSandboxExecutor } from "@si-arena/sandbox";
import { resolveResourceLimits } from "@si-arena/protocol";
import { paperGame } from "@si-arena/game-paper/game";
import type { PaperState, PaperAction } from "@si-arena/game-paper/sdk";
import { MemoryReplaySink, runMatch, replayMatch } from "@si-arena/engine";
import { createReplaySession } from "@si-arena/player";
import { defineLocalGame } from "@si-arena/cli";
import { PAPER_SDK_SOURCE, officialBotUrl } from "@si-arena/game-paper/game";
const registration = defineLocalGame({game:paperGame,sdkSource:PAPER_SDK_SOURCE,officialBotUrl});
if(registration.manifest.id!=="paper")throw new Error("Packed CLI registration failed");
let state = paperRules.init({
  seed: 2, config: paperManifest.config,
  players: [{ id: "alpha", slot: 0 }, { id: "beta", slot: 1 }],
});
let result: PaperResult | undefined;
for (let tick = 0; tick < 600; tick++) {
  const output = paperRules.step(state, { alpha: { type: "idle" }, beta: { type: "idle" } });
  state = output.nextState; result = output.result;
}
if (result?.completedTicks !== 600 || result.players.some(p => p.rank !== 1 || p.score !== 9 || !p.alive)) {
  throw new Error("Standalone match returned an unexpected result");
}
const bot = await SandboxPlayer.create({
  matchId: "artifact", playerId: "alpha", source: "export default ({Memory})=>{Memory.n=(Memory.n??0)+1;return {type:'idle'}}",
  limits: resolveResourceLimits({cpuMs:100}), isolation: {kind:"local"},
  parseAction: paperRules.parseAction, defaultAction: {type:"idle"},
});
try {
  const first = await bot.execute(0, paperRules.observe(state, "alpha"));
  const second = await bot.execute(1, {});
  if (!first.ok || !second.ok || second.memory.n !== 2) throw new Error("Packed sandbox failed");
} finally { await bot.close(); }
const sink = new MemoryReplaySink<PaperState,PaperAction>();
const played = await runMatch({
  matchId:"packed-engine", game:paperGame, seed:2, sink,
  players:[{id:"alpha",slot:0,name:"Alpha",official:false},{id:"beta",slot:1,name:"Beta",official:true}],
  async createExecutor(player,context) {
    return createSandboxExecutor({...context,playerId:player.id,
      source:player.id==="alpha"?"export default ()=>({type:'move',direction:'left'})":"export default ()=>({type:'idle'})",
      isolation:{kind:"local"},parseAction:paperRules.parseAction,
    });
  },
});
const replayed = await replayMatch(sink.replay,paperGame);
if(played.result.reason!=="last-survivor" || replayed.finalStateHash!==played.finalStateHash)throw new Error("Packed engine/replay mismatch");
const playback = await createReplaySession(sink.replay,paperGame);
if(playback.frame(played.result.completedTicks).state.tick!==played.result.completedTicks || playback.frame(0).record!==null)throw new Error("Packed playback seek failed");
`,
  );
  await writeFile(
    join(temporary, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: false,
        types: ["node"],
        lib: ["ES2023", "DOM"],
        outDir: "out",
      },
      include: ["consumer.ts"],
    }),
  );
  runNode(
    [join(root, "node_modules/typescript/bin/tsc"), "-p", join(temporary, "tsconfig.json")],
    temporary,
  );
  runNode(["out/consumer.js"], temporary);
  assert.ok(cliDirectory, "CLI archive is missing");
  assert.match(runNode([join(cliDirectory, "dist/main.js"), "--help"], temporary), /SI Arena CLI/);
  const cliManifest = JSON.parse(
    await readFile(join(cliDirectory, "package.json"), "utf8"),
  ) as Manifest;
  assert.equal(
    runNode([join(cliDirectory, "dist/main.js"), "--version"], temporary).trim(),
    `${cliManifest.name} ${cliManifest.version}`,
  );
  await writeFile(
    join(temporary, "arena.config.mjs"),
    `
import {defineLocalGame} from "@si-arena/cli";
import {paperGame,PAPER_SDK_SOURCE,officialBotUrl} from "@si-arena/game-paper/game";
export default [defineLocalGame({game:paperGame,sdkSource:PAPER_SDK_SOURCE,officialBotUrl})];
`,
  );
  await writeFile(
    join(temporary, "bot.js"),
    `export default ({Memory})=>{Memory.n=(Memory.n??0)+1;console.log(Memory.n);return {type:"move",direction:"left"}}`,
  );
  await writeFile(join(temporary, "opponent.js"), `export default ()=>({type:"idle"})`);
  const cliRun = runNode(
    [
      join(cliDirectory, "dist/main.js"),
      "--registry",
      "./arena.config.mjs",
      "run",
      "--bot",
      "./bot.js",
      "--opponent",
      "./opponent.js",
      "--matches",
      "2",
      "--seed",
      "42",
    ],
    temporary,
  )
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          type: string;
          replay?: string;
          logCount?: number;
          verified?: boolean;
          matches?: number;
        },
    );
  assert.equal(cliRun.filter((record) => record.type === "match").length, 2);
  assert.equal(cliRun.at(-1)?.matches, 2);
  const cliMatch = cliRun.find((record) => record.type === "match");
  assert.ok(cliMatch?.replay);
  assert.ok(cliMatch.logCount! > 0);
  await rm(join(temporary, "bot.js"));
  await rm(join(temporary, "opponent.js"));
  const cliReplay = runNode(
    [
      join(cliDirectory, "dist/main.js"),
      "--registry",
      "./arena.config.mjs",
      "replay",
      cliMatch.replay,
      "--verify",
      "--logs",
    ],
    temporary,
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; verified?: boolean });
  assert.ok(cliReplay.some((record) => record.type === "diagnostic"));
  assert.equal(cliReplay.at(-1)?.verified, true);
  const appUrl = pathToFileURL(join(root, "apps/server/dist/app.js")).href;
  runNode(
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    const { buildApp } = await import(${JSON.stringify(appUrl)});
    const app = buildApp();
    try {
      assert.equal((await app.inject("/health")).statusCode, 200);
      assert.equal((await app.inject("/api/games")).json().games[0].id, "paper");
    } finally { await app.close(); }
  `,
    ],
    root,
  );
  console.log(
    `Verified ${archives.length} packed packages and ${entries.length} public exports outside the workspace, strict NodeNext types, a 600-tick match, isolated sandbox, CLI batch/replay without bot files and compiled API.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
