import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { devkitGames } from "../configs/devkits";

const root = fileURLToPath(new URL("../", import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run with pnpm test:artifacts");
const execute = promisify(execFile);
const env = { ...process.env, NODE_OPTIONS: "" };
const node = async (args: string[], cwd = root, additions: NodeJS.ProcessEnv = {}) =>
  (
    await execute(process.execPath, args, {
      cwd,
      env: { ...env, ...additions },
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout;
const install = async (cwd: string) => {
  const script = /\.[cm]?js$/.test(pnpm);
  await execute(
    script ? process.execPath : pnpm,
    script
      ? [pnpm, "install", "--frozen-lockfile", "--ignore-scripts"]
      : ["install", "--frozen-lockfile", "--ignore-scripts"],
    { cwd, env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
};
function service(args: string[], cwd = root) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "pipe" });
  let stderr = "";
  child.stderr.on("data", (value) => {
    stderr += String(value);
  });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Service startup timed out: " + stderr)),
      20_000,
    );
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const value = JSON.parse(line) as { url?: string };
        if (value.url) {
          clearTimeout(timer);
          lines.close();
          resolve(value.url);
        }
      } catch {
        /* Startup diagnostics can precede the URL. */
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Service exited (${code}): ${stderr}`));
    });
  });
  return { child, ready };
}
const temporary = await mkdtemp(join(tmpdir(), "si-arena-devkit-verification-"));
const services: ReturnType<typeof service>[] = [];
try {
  const builtArchives = join(temporary, "built-releases");
  const archives = join(temporary, "releases");
  await node(["--import", "tsx", join(root, "scripts/build-devkits.ts")], root, {
    DEVKITS_DIR: builtArchives,
  });
  await node(["--import", "tsx", join(root, "scripts/seed-releases.ts"), builtArchives, archives]);
  // Deployment retries must preserve existing revisions and selectors.
  await node(["--import", "tsx", join(root, "scripts/seed-releases.ts"), builtArchives, archives]);
  const appUrl = pathToFileURL(join(root, "apps/server/dist/app.js")).href;
  const api = service([
    "--input-type=module",
    "-e",
    `const {buildApp}=await import(${JSON.stringify(appUrl)}); const app=buildApp({releasesDir:${JSON.stringify(archives)}}); const url=await app.listen({host:'127.0.0.1',port:0}); console.log(JSON.stringify({url})); process.once('SIGTERM',()=>void app.close());`,
  ]);
  services.push(api);
  const server = await api.ready;
  for (const registration of devkitGames) {
    const project = join(temporary, registration.game.manifest.id);
    const initialized = JSON.parse(
      (
        await node([
          join(root, "packages/cli/dist/main.js"),
          "init",
          registration.game.manifest.id,
          project,
          "--server",
          server,
          "--release",
          registration.game.manifest.release,
        ])
      ).trim(),
    ) as { type: string; directory: string };
    assert.equal(initialized.type, "initialized");
    assert.equal(initialized.directory, project);
    assert.ok(
      !(await readdir(project)).includes("node_modules"),
      "init must not install or execute modules",
    );
    await install(project);
    const materialsResponse = await fetch(
      new URL(`/api/games/${registration.game.manifest.id}/development`, server),
    );
    assert.equal(materialsResponse.status, 200);
    const materials = (await materialsResponse.json()) as { prompt: string };
    assert.equal(await readFile(join(project, "PROMPT.md"), "utf8"), materials.prompt);
    assert.ok(materials.prompt.includes("## 研究目标与预算"));
    assert.ok(!materials.prompt.includes("<!-- SI_ARENA_RESEARCH -->"));
    const original = await readFile(join(project, "bot.js"), "utf8");
    await writeFile(join(project, "bot.js"), 'console.log("local verification");\n' + original);
    const run = (
      await node(
        ["arena.mjs", "run", "--bot", "./bot.js", "--matches", "2", "--seed", "42"],
        project,
      )
    )
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            replay?: string;
            logCount?: number;
            matches?: number;
          },
      );
    assert.equal(run.filter((value) => value.type === "match").length, 2);
    assert.equal(run.at(-1)?.matches, 2);
    const match = run.find((value) => value.type === "match");
    assert.ok(match?.replay);
    assert.ok((match.logCount ?? 0) > 0);
    const dev = service(["arena.mjs", "dev", "--bot", "./bot.js", "--seed", "7"], project);
    services.push(dev);
    const devUrl = await dev.ready;
    assert.match(await (await fetch(devUrl)).text(), /本地调试/);
    assert.equal((await fetch(new URL("/dev.html", devUrl))).status, 200);
    const devStatus = async () =>
      (await (await fetch(new URL("/api/session", devUrl))).json()) as {
        current: { phase: string; run: number; seed: number };
        lastCompleted: { matchId: string } | null;
      };
    const waitForDevRun = async (runNumber: number) => {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const status = await devStatus();
        if (status.current.run === runNumber && status.current.phase === "completed") return status;
        if (Date.now() > deadline) throw new Error(`Dev run ${runNumber} did not complete`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    const devCompleted = await waitForDevRun(1);
    assert.equal(devCompleted.current.seed, 7);
    assert.ok(devCompleted.lastCompleted?.matchId);
    const devReplay = (await (await fetch(new URL("/api/session/replay", devUrl))).json()) as {
      matchId: string;
    };
    assert.equal(devReplay.matchId, devCompleted.lastCompleted!.matchId);
    const devMemory = (await (
      await fetch(new URL("/api/session/memory?tick=0", devUrl))
    ).json()) as { players: Record<string, unknown> };
    assert.ok(devMemory.players.bot);
    assert.equal(
      (await fetch(new URL("/api/session/restart", devUrl), { method: "POST" })).status,
      200,
    );
    await waitForDevRun(2);
    dev.child.kill("SIGTERM");
    await once(dev.child, "exit");
    await rm(join(project, "bot.js"));
    await rm(join(project, "bots/official.js"));
    await rm(join(project, "node_modules", registration.packageName, "bots/official.js"));
    const replay = (
      await node(["arena.mjs", "replay", match.replay, "--verify", "--logs"], project)
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; verified?: boolean });
    assert.ok(replay.some((record) => record.type === "diagnostic"));
    assert.equal(replay.at(-1)?.verified, true);
    const viewer = service(["arena.mjs", "replay", match.replay], project);
    services.push(viewer);
    const url = await viewer.ready;
    assert.match(await (await fetch(url)).text(), /本地回放/);
    assert.equal((await fetch(new URL("/replay.json.gz", url))).status, 200);
    assert.equal((await fetch(new URL("/bot.js", url))).status, 404);
    viewer.child.kill("SIGTERM");
    await once(viewer.child, "exit");
    // Editing the starter and removing bot sources must not prevent replay or SDK consumption.
    await writeFile(
      join(project, "consumer.ts"),
      `import type { ${registration.sdkInputType} as TickInput } from '${registration.packageName}/sdk'; import type { ${registration.sdkInputType} as LocalTickInput } from './sdk/index.d.ts'; export type Observation = TickInput['game']; export type LocalObservation = LocalTickInput['game'];`,
    );
    await writeFile(
      join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2023",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          types: [],
          skipLibCheck: false,
        },
        include: ["consumer.ts"],
      }),
    );
    await node(
      [join(root, "node_modules/typescript/bin/tsc"), "-p", join(project, "tsconfig.json")],
      project,
    );
    const metadataResponse = await fetch(
      new URL(
        `/api/games/${registration.game.manifest.id}/releases/${encodeURIComponent(registration.game.manifest.release)}`,
        server,
      ),
    );
    assert.equal(metadataResponse.status, 200);
  }
  console.log(
    `Verified ${devkitGames.length} standalone ZIP development package(s): real API download and init, frozen pnpm installation, official opponents, batch matches, logs, replay after removing bots, local viewer and strict NodeNext SDK types outside the workspace.`,
  );
} finally {
  for (const { child } of services)
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await Promise.all(
    services
      .filter(({ child }) => child.exitCode === null && child.signalCode === null)
      .map(({ child }) => once(child, "exit").catch(() => {})),
  );
  await rm(temporary, { recursive: true, force: true });
}
