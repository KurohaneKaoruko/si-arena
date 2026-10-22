import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { replayMatch } from "@si-arena/engine";
import { readReplayFile } from "@si-arena/engine/node";
import { resolveResourceLimits } from "@si-arena/protocol";
import { runMatchProcess, validateSource, RunnerSystemError, type RunMatchOptions } from "../src";
import { RunnerProcess } from "../src/process";
import { game } from "./fixtures/game";
const paths: string[] = [];
afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "arena-runner-test-"));
  paths.push(path);
  return path;
}
function options(
  sources = ["export default ({game})=>game.add(1)", "export default ({game})=>game.add(1)"],
): RunMatchOptions {
  return {
    module: {
      url: new URL("./fixtures/game.ts", import.meta.url).href,
      gameExport: "game",
      sdkSourceExport: "sdkSource",
    },
    manifest: game.manifest,
    matchId: "runner-match",
    seed: 42,
    players: sources.map((_, slot) => ({
      id: `p${slot}`,
      slot,
      name: `P${slot}`,
      official: false,
    })),
    sources,
    isolation: { kind: "local" },
  };
}

test("shared isolates preserve independent checkpoints through exceptions and CPU limits", async () => {
  const memories: unknown[] = [];
  const progress: number[] = [];
  const opts = options([
    "export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;console.log(Memory.n);if(game.tick===1)throw new Error('boom');if(game.tick===2)while(true){};game.add(Memory.n)}",
    "export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;game.add(1)}",
  ]);
  const summary = await runMatchProcess({
    ...opts,
    captureLogs: true,
    onMemory: (id, tick, memory) => memories.push({ id, tick, memory }),
    onTick: (tick) => progress.push(tick),
  });
  expect(summary.errorCount).toBe(2);
  expect(summary.result.players.map((p) => p.score)).toEqual([3, 4]);
  const replay = summary.replayData!;
  expect(replay.ticks[1]?.errors?.p0?.type).toBe("RUNTIME_ERROR");
  expect(replay.ticks[2]?.errors?.p0?.type).toBe("CPU_LIMIT");
  expect(replay.ticks.flatMap((t) => t.logs?.p0 ?? []).map((log) => log.message)).toEqual([
    "1",
    "2",
    "2",
    "2",
  ]);
  expect(memories).toContainEqual({ id: "p0", tick: 3, memory: { n: 2 } });
  expect(progress.at(-1)).toBe(4);
  expect((await replayMatch(replay, game)).finalStateHash).toBe(summary.finalStateHash);
  expect(JSON.stringify(replay)).not.toMatch(/export default|"memory"/);
});

test("Memory diagnostics survive a paused receiver without changing the match or replay", async () => {
  const opts = options(
    Array<string>(5).fill(
      "export default({game,Memory})=>{Memory.blob='x'.repeat(60*1024);Memory.tick=game.tick;game.add(1)}",
    ),
  );
  opts.manifest = {
    ...opts.manifest,
    resolvedLimits: resolveResourceLimits({
      ...opts.manifest.resolvedLimits,
      codeBytes: 1024,
      observationBytes: 1024,
      ipcBytes: 96 * 1024,
    }),
  };
  const baseline = await runMatchProcess(opts);
  const memories: Array<{ playerId: string; tick: number; memoryTick: unknown }> = [];
  const truncated = vi.fn();
  const summary = await runMatchProcess({
    ...opts,
    onMemory(playerId, tick, memory) {
      if (memories.length === 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      expect(memory.blob).toHaveLength(60 * 1024);
      memories.push({ playerId, tick, memoryTick: memory.tick });
    },
    onMemoryTruncated: truncated,
  });
  expect(memories).toEqual(
    Array.from({ length: 4 }, (_, tick) =>
      opts.players.map(({ id }) => ({ playerId: id, tick, memoryTick: tick })),
    ).flat(),
  );
  expect(truncated).not.toHaveBeenCalled();
  expect(summary.errorCount).toBe(0);
  expect(summary.result).toEqual(baseline.result);
  expect(summary.finalStateHash).toBe(baseline.finalStateHash);
  expect(
    (await replayMatch(summary.replayData!, { ...game, manifest: opts.manifest })).finalStateHash,
  ).toBe(summary.finalStateHash);
});

test("heap, microtask, invalid action and malicious Memory failures leave sibling isolates running", async () => {
  const faults = [
    "new ArrayBuffer(64*1024*1024)",
    "Promise.resolve().then(()=>{while(true){}})",
    "game.add(99)",
    "Object.prototype.toJSON=()=>({ok:true});Memory.bad=undefined",
  ];
  const opts = options([
    ...faults.map(
      (fault) =>
        `export default({game,Memory})=>{Memory.n=(Memory.n??0)+1;game.add(Memory.n);if(game.tick===1){${fault}}}`,
    ),
    "export default({game,Memory})=>{Memory.n=(Memory.n??0)+1;game.add(1)}",
  ]);
  opts.manifest = {
    ...opts.manifest,
    resolvedLimits: resolveResourceLimits({
      ...opts.manifest.resolvedLimits,
      heapBytes: 8 * 1024 * 1024,
    }),
  };
  const summary = await runMatchProcess(opts);
  expect(summary.errorCount).toBe(4);
  expect(summary.result.players.map((p) => p.score)).toEqual([6, 6, 6, 6, 4]);
  expect(Object.values(summary.replayData!.ticks[1]!.errors!).map((error) => error.type)).toEqual([
    "HEAP_LIMIT",
    "CPU_LIMIT",
    "INVALID_ACTION",
    "MEMORY_INVALID",
  ]);
  expect(summary.replayData!.ticks[2]!.errors).toBeUndefined();
});

test("runner crashes fail only that match and never publish a replay or cancel siblings", async () => {
  const dir = await directory(),
    bad = options(),
    good = options();
  bad.module = { ...bad.module, gameExport: "crashGame" };
  bad.replayPath = join(dir, "bad.json.gz");
  good.replayPath = join(dir, "good.json.gz");
  const result = await Promise.allSettled([runMatchProcess(bad), runMatchProcess(good)]);
  expect(result[0]?.status).toBe("rejected");
  expect(result[1]?.status).toBe("fulfilled");
  expect(await readdir(dir)).toEqual(["good.json.gz"]);
  expect(
    (await replayMatch(await readReplayFile(good.replayPath!), game)).result.completedTicks,
  ).toBe(4);
});

test("cancellation kills a running match and removes only its private staging files", async () => {
  const dir = await directory(),
    controller = new AbortController();
  const opts = options(["export default ()=>{while(true){}}", "export default ()=>{}"]);
  await expect(
    runMatchProcess({
      ...opts,
      replayPath: join(dir, "cancelled.json.gz"),
      signal: controller.signal,
      onTick: () => controller.abort(),
    }),
  ).rejects.toThrow(/cancelled|stopped/);
  expect(await readdir(dir)).toEqual([]);
  await expect(runMatchProcess({ ...opts, signal: controller.signal })).rejects.toThrow(
    "cancelled",
  );
});

test("published paths are never overwritten and cross-match caches start empty", async () => {
  const dir = await directory(),
    path = join(dir, "keep.json.gz");
  await writeFile(path, "keep");
  await expect(runMatchProcess({ ...options(), replayPath: path })).rejects.toThrow("EEXIST");
  expect(await readFile(path, "utf8")).toBe("keep");
  const opts = options([
    "let n=0;export default({game,Memory})=>{n++;Memory.n=(Memory.n??0)+1;game.add(n)}",
    "export default()=>{}",
  ]);
  const a = await runMatchProcess(opts),
    b = await runMatchProcess(opts);
  expect(a.result).toEqual(b.result);
  expect(a.finalStateHash).toBe(b.finalStateHash);
});

test("aggregate sources larger than one IPC frame are bound separately", async () => {
  const source = "/*" + "x".repeat(220 * 1024) + "*/export default()=>{}";
  const summary = await runMatchProcess(options(Array<string>(5).fill(source)));
  expect(summary.errorCount).toBe(0);
  expect(summary.result.players).toHaveLength(5);
});

test("source binding handles escaped controls and sources split across bounded frames", async () => {
  const source = "/*" + "\0".repeat(220 * 1024) + "*/export default()=>{}";
  const limits = game.manifest.resolvedLimits;
  expect(await validateSource({ source, limits, isolation: { kind: "local" } })).toEqual({
    ok: true,
  });
  expect((await runMatchProcess(options([source, source]))).errorCount).toBe(0);
  const large = "/*" + "x".repeat(1024 * 1024 - 32) + "*/export default()=>{}";
  const opts = options([large, large]);
  opts.manifest = {
    ...opts.manifest,
    resolvedLimits: resolveResourceLimits({ codeBytes: 1024 * 1024, ipcBytes: 1248 * 1024 }),
  };
  expect((await runMatchProcess(opts)).errorCount).toBe(0);
});

test("release memory capacity and unexpected trusted module bindings fail as system errors", async () => {
  const opts = options();
  await expect(runMatchProcess({ ...opts, players: opts.players.toReversed() })).rejects.toThrow(
    "identity",
  );
  await expect(
    runMatchProcess({
      ...opts,
      manifest: {
        ...opts.manifest,
        resolvedLimits: resolveResourceLimits({ runnerMemoryBytes: 160 * 1024 * 1024 }),
      },
    }),
  ).rejects.toThrow("all player heaps");
  await expect(
    runMatchProcess({ ...opts, module: { ...opts.module, gameExport: "missing" } }),
  ).rejects.toBeInstanceOf(RunnerSystemError);
});

test.each([
  "import x from 'node:fs';export default()=>{}",
  "export * from 'x'",
  "export {x} from 'x'",
  "export default()=>import('x')",
  "await Promise.resolve();export default()=>{}",
  "function broken( {",
])("isolated validation rejects unsupported source %s", async (source) => {
  expect(
    await validateSource({
      source,
      limits: game.manifest.resolvedLimits,
      isolation: { kind: "local" },
    }),
  ).toMatchObject({ ok: false, error: { type: "ENTRYPOINT_ERROR" } });
});
test("validation compiles without evaluating player top-level code and bounds source before startup", async () => {
  expect(
    await validateSource({
      source: "while(true){};export default()=>{}",
      limits: game.manifest.resolvedLimits,
      isolation: { kind: "local" },
    }),
  ).toEqual({ ok: true });
  const start = vi.spyOn(RunnerProcess, "start");
  await expect(
    validateSource({
      source: "x".repeat(1025),
      limits: resolveResourceLimits({ codeBytes: 1024 }),
      isolation: { kind: "local" },
    }),
  ).rejects.toThrow("source");
  expect(start).not.toHaveBeenCalled();
});

test.skipIf(process.platform === "win32")(
  "a stopped runner is terminated by the external progress watchdog",
  async () => {
    const host = await RunnerProcess.start(game.manifest.resolvedLimits, { kind: "local" });
    try {
      process.kill(host.pid!, "SIGSTOP");
      await expect(
        host.request(
          {
            kind: "validate",
            source: "export default()=>{}",
            limits: game.manifest.resolvedLimits,
          },
          50,
          (message) => message.kind === "validated",
        ),
      ).rejects.toThrow("stopped making progress");
    } finally {
      await host.close();
    }
  },
);
