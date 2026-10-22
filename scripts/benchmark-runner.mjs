// Run after build:packages. --baseline accepts either an old checkout or a frozen package graph.
import { readFile, writeFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir, cpus, availableParallelism, platform, arch } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    baseline: { type: "string" },
    pairs: { type: "string", default: "6" },
    all: { type: "boolean", default: false },
    out: { type: "string" },
    resources: { type: "boolean", default: false },
    game: { type: "string" },
    probe: { type: "string" },
    "probe-game": { type: "string" },
    "probe-workload": { type: "string", default: "official" },
    "probe-logs": { type: "boolean", default: false },
  },
});
if (!values.baseline)
  throw new Error("Supply --baseline <built old checkout or frozen package graph>");
const count = Number(values.pairs);
if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Invalid --pairs");
const temporary = await mkdtemp(join(tmpdir(), "arena-runner-bench-"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const median = (samples) => {
  const ordered = samples.toSorted((left, right) => left - right);
  return ordered.length % 2
    ? ordered[(ordered.length - 1) / 2]
    : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2;
};
async function load(base) {
  const loadPackage = async (name, subpath = ".") => {
    const folder = name.startsWith("@si-arena/game-")
      ? `games/${name.slice("@si-arena/game-".length)}`
      : `packages/${name.slice("@si-arena/".length)}`;
    let directory = join(base, folder);
    if (!(await stat(join(directory, "package.json")).catch(() => null)))
      directory = join(base, "node_modules", name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const url = pathToFileURL(join(directory, manifest.exports[subpath].import)).href;
    return { module: await import(url), url };
  };
  return {
    engine: (await loadPackage("@si-arena/engine")).module,
    node: (await loadPackage("@si-arena/engine", "./node")).module,
    protocol: (await loadPackage("@si-arena/protocol")).module,
    sandbox: (await loadPackage("@si-arena/sandbox")).module,
    runner: await loadPackage("@si-arena/runner")
      .then((x) => x.module)
      .catch(() => undefined),
    games: await Promise.all(
      ["paper", "royale"].map(async (id) => ({
        id,
        ...(await loadPackage(`@si-arena/game-${id}`, "./game")),
      })),
    ),
  };
}
const baselineMetadata = JSON.parse(
  await readFile(join(resolve(values.baseline), "baseline.json"), "utf8").catch(() => "{}"),
);
function gitRevision(directory) {
  try {
    return execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}
const report = {
  collectedAt: new Date().toISOString(),
  baseline: resolve(values.baseline),
  baselineRevision:
    baselineMetadata.revision ?? gitRevision(resolve(values.baseline)) ?? "unrecorded",
  baselinePackageSha256: baselineMetadata.packageSha256,
  workingDiffSha256: hash(execFileSync("git", ["diff", "--binary"])),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    cores: availableParallelism(),
    platform: platform(),
    arch: arch(),
  },
  methodology:
    "Paired seeds, alternating order, one excluded warmup per mode/scenario. Same source texts, player CPU/heap/Memory/wall budgets and SDK interface. The new trusted SDK captures array intrinsics; source text is therefore not identical. Match timing includes process startup, all ticks, gzip+fsync, process shutdown and final path publication; validation preparation and replay verification measured separately. No database, queue wait or browser rendering. Parent CPU and billed player CPU are reported separately; only the new runner reports complete child-process CPU and peak RSS. Separate optional resource probes include driver startup, module loading and match execution, excluding replay verification. Their CPU covers waited descendants; tree RSS is sampled every 20ms plus ps duration, and largest-process RSS is a kernel high-water mark. Probe sampling does not run during paired timing samples.",
  scenarios: [],
  batches: [],
};
function withLogs(source) {
  return (
    source.replace("export default", "const __arenaBenchmarkTick =") +
    '\nexport default function(args){if(args.game.tick%16===0)console.log("tick",args.game.tick);return __arenaBenchmarkTick(args)}'
  );
}

// Separate diagnostic passes leave paired wall-time samples untouched. wait() resource
// usage includes waited descendants. ps samples aggregate driver + descendant RSS.
const RESOURCE_PROBE = String.raw`
import sys, subprocess, resource, time, json
started = time.monotonic()
child = subprocess.Popen(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
peak = 0
sampler_cpu = 0
while child.poll() is None:
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    snapshot = subprocess.run(["ps", "-axo", "pid=,ppid=,rss="], capture_output=True, text=True, check=True)
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    sampler_cpu += (after.ru_utime + after.ru_stime) - (before.ru_utime + before.ru_stime)
    rows = [list(map(int, line.split())) for line in snapshot.stdout.splitlines()]
    descendants = {child.pid}
    while True:
        expanded = descendants | {pid for pid, ppid, rss in rows if ppid in descendants}
        if expanded == descendants: break
        descendants = expanded
    peak = max(peak, sum(rss * 1024 for pid, ppid, rss in rows if pid in descendants))
    time.sleep(0.02)
stdout, stderr = child.communicate()
if child.returncode:
    raise RuntimeError(stderr)
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
print(json.dumps({
    "cpuUs": round(((usage.ru_utime + usage.ru_stime) - sampler_cpu) * 1e6),
    "sampledTreePeakRssBytes": peak,
    "largestProcessPeakRssBytes": usage.ru_maxrss * (1 if sys.platform == "darwin" else 1024),
    "measurement": json.loads(stdout),
}))
`;
try {
  const modes = { before: await load(resolve(values.baseline)), after: await load(process.cwd()) };
  if (!modes.after.runner) throw new Error("Build the new runner first");
  for (const id of values.probe
    ? [values["probe-game"]]
    : values.game
      ? [values.game]
      : ["paper", "royale"]) {
    const registrations = Object.fromEntries(
      Object.entries(modes).map(([mode, graph]) => [
        mode,
        graph.games.find((entry) => entry.id === id),
      ]),
    );
    const official = await readFile(registrations.before.module.officialBotUrl, "utf8");
    const workloads = {
      official,
      idle: "export default()=>{}",
      compute:
        "export default({Memory})=>{let sum=0;for(let i=0;i<25000;i++)sum+=Math.sqrt(i);Memory.sum=sum}",
      memory:
        "export default({Memory})=>{Memory.blob??='x'.repeat(60*1024);Memory.n=(Memory.n??0)+1}",
    };
    const run = async (mode, source, seed, captureLogs, name, pendingVerifications) => {
      const impl = modes[mode],
        entry = registrations[mode],
        game = entry.module[`${id}Game`],
        sdkSource = entry.module[`${id.toUpperCase()}_SDK_SOURCE`];
      const seats = id === "paper" ? 2 : 5;
      const players = Array.from({ length: seats }, (_, slot) => ({
        id: `p${slot}`,
        slot,
        name: `P${slot}`,
        official: true,
      }));
      const path = join(temporary, `${name}-${mode}-${seed}.json.gz`);
      const before = process.cpuUsage(),
        started = performance.now();
      let summary;
      const startupSamples = [];
      let replayFinalizeUs = 0;
      class TimedSink extends impl.node.ReplayFileSink {
        async finish(footer) {
          const start = performance.now();
          try {
            await super.finish(footer);
          } finally {
            replayFinalizeUs = (performance.now() - start) * 1000;
          }
        }
      }
      if (mode === "before")
        summary = await impl.engine.runMatch({
          matchId: "runner-benchmark",
          game,
          players,
          seed,
          captureLogs,
          sink: new TimedSink(path),
          async createExecutor(player, context) {
            const start = performance.now();
            try {
              return await impl.sandbox.SandboxPlayer.create({
                ...context,
                source,
                playerId: player.id,
                sdkSource,
                parseAction: game.rules.parseAction,
                defaultAction: { type: "idle" },
                isolation: { kind: "local" },
              });
            } finally {
              startupSamples.push((performance.now() - start) * 1000);
            }
          },
        });
      else
        summary = await impl.runner.runMatchProcess({
          module: {
            url: entry.url,
            gameExport: `${id}Game`,
            sdkSourceExport: `${id.toUpperCase()}_SDK_SOURCE`,
          },
          manifest: game.manifest,
          matchId: "runner-benchmark",
          seed,
          players,
          sources: players.map(() => source),
          replayPath: path,
          captureLogs,
          isolation: { kind: "local" },
        });
      const wallUs = Math.round((performance.now() - started) * 1000),
        parent = process.cpuUsage(before);
      const measurement = {
        seed,
        wallUs,
        parentCpuUs: parent.user + parent.system,
        phases: summary.metrics
          ? {
              startupUs: summary.metrics.startupMs * 1000,
              matchUs: summary.metrics.wallMs * 1000,
              replayFinalizeUs: summary.metrics.replayFinalizeMs * 1000,
              publishUs: summary.metrics.publishMs * 1000,
            }
          : { startupUs: Math.max(...startupSamples), matchUs: wallUs, replayFinalizeUs },
        ...(summary.metrics
          ? { runnerCpuUs: summary.metrics.cpuUs, runnerPeakRssBytes: summary.metrics.peakRssBytes }
          : {}),
        ticks: summary.result.completedTicks,
        result: summary.result,
        finalStateHash: summary.finalStateHash,
      };
      const verify = async () => {
        const verifyStart = performance.now();
        const replay = await impl.node.readReplayFile(path);
        const verified = await impl.engine.replayMatch(replay, game);
        if (summary.finalStateHash !== verified.finalStateHash) throw new Error("Replay mismatch");
        Object.assign(measurement, {
          errors: replay.ticks.flatMap((t) => Object.values(t.errors ?? {})).map((e) => e.type),
          billedPlayerCpuUs: replay.ticks.reduce(
            (sum, t) =>
              sum + Object.values(t.resources ?? {}).reduce((n, r) => n + (r.cpuUsedUs ?? 0), 0),
            0,
          ),
          actionsSha256: hash(
            JSON.stringify(replay.ticks.map((t) => ({ tick: t.tick, actions: t.actions }))),
          ),
          verifyUs: Math.round((performance.now() - verifyStart) * 1000),
        });
      };
      if (pendingVerifications) pendingVerifications.push(verify);
      else await verify();
      return measurement;
    };
    if (values.probe) {
      if (
        !["before", "after"].includes(values.probe) ||
        !Object.hasOwn(workloads, values["probe-workload"])
      )
        throw new Error("Invalid resource probe");
      let source = workloads[values["probe-workload"]];
      if (values["probe-logs"]) source = withLogs(source);
      const result = await run(values.probe, source, 42, values["probe-logs"], "probe", []);
      process.stdout.write(JSON.stringify(result));
      continue;
    }
    for (const [workload, baseSource] of Object.entries(values.all ? workloads : { official }))
      for (const captureLogs of values.all ? [false, true] : [false]) {
        const source = captureLogs ? withLogs(baseSource) : baseSource;
        const scenario = {
          game: id,
          workload,
          captureLogs,
          sourceSha256: hash(source),
          preparationUs: {},
          samples: [],
        };
        for (const mode of ["before", "after"]) {
          const impl = modes[mode],
            limits = registrations[mode].module[`${id}Game`].manifest.resolvedLimits;
          const start = performance.now();
          const result = await (mode === "before" ? impl.sandbox : impl.runner).validateSource({
            source,
            limits,
            isolation: { kind: "local" },
          });
          if (!result.ok) throw new Error("Validation failed");
          scenario.preparationUs[mode] = Math.round((performance.now() - start) * 1000);
          await run(mode, source, 41, captureLogs, `warm-${id}-${workload}-${captureLogs}`);
        }
        const pairs = workload === "official" ? count : Math.min(count, 2);
        for (let pair = 0; pair < pairs; pair++) {
          const sample = { seed: 42 + pair };
          for (const mode of pair % 2 ? ["after", "before"] : ["before", "after"])
            sample[mode] = await run(
              mode,
              source,
              sample.seed,
              captureLogs,
              `${id}-${workload}-${captureLogs}-${pair}`,
            );
          if (
            sample.before.actionsSha256 !== sample.after.actionsSha256 ||
            sample.before.finalStateHash !== sample.after.finalStateHash ||
            JSON.stringify(sample.before.result) !== JSON.stringify(sample.after.result)
          )
            throw new Error(`Different decisions in ${id}/${workload}`);
          if (sample.before.errors.length || sample.after.errors.length)
            throw new Error(`Player errors in ${id}/${workload}`);
          scenario.samples.push(sample);
        }
        scenario.beforeMedianUs = median(scenario.samples.map((p) => p.before.wallUs));
        scenario.afterMedianUs = median(scenario.samples.map((p) => p.after.wallUs));
        scenario.reductionPercent = 100 * (1 - scenario.afterMedianUs / scenario.beforeMedianUs);
        report.scenarios.push(scenario);
        process.stderr.write(
          `${id}/${workload}/logs=${captureLogs}: ${Math.round(scenario.beforeMedianUs / 1000)} -> ${Math.round(scenario.afterMedianUs / 1000)} ms (${scenario.reductionPercent.toFixed(1)}%)\n`,
        );
      }
    const seats = id === "paper" ? 2 : 5,
      limits = registrations.after.module[`${id}Game`].manifest.resolvedLimits;
    const jobs = Math.min(
      8,
      Math.max(1, Math.floor(availableParallelism() / seats)),
      Math.floor(process.availableMemory() / limits.runnerMemoryBytes),
    );
    if (jobs < 1) throw new Error("Insufficient batch memory");
    const batch = { game: id, matches: 8, jobs, samples: [] };
    for (let pair = 0; pair < 3; pair++) {
      const sample = {};
      for (const mode of pair % 2 ? ["after", "before"] : ["before", "after"]) {
        const start = performance.now();
        let next = 0;
        const results = [];
        const verifications = [];
        await Promise.all(
          Array.from({ length: mode === "before" ? 1 : jobs }, async () => {
            for (;;) {
              const index = next++;
              if (index >= 8) return;
              results[index] = await run(
                mode,
                official,
                100 + index,
                false,
                `batch-${id}-${pair}-${index}`,
                verifications,
              );
            }
          }),
        );
        sample[mode] = { wallUs: Math.round((performance.now() - start) * 1000), results };
        for (const verify of verifications) await verify();
      }
      if (
        sample.before.results.some(
          (r, i) =>
            r.actionsSha256 !== sample.after.results[i].actionsSha256 ||
            r.finalStateHash !== sample.after.results[i].finalStateHash ||
            JSON.stringify(r.result) !== JSON.stringify(sample.after.results[i].result) ||
            r.errors.length ||
            sample.after.results[i].errors.length,
        )
      )
        throw new Error("Batch mismatch");
      batch.samples.push(sample);
    }
    batch.beforeMedianUs = median(batch.samples.map((p) => p.before.wallUs));
    batch.afterMedianUs = median(batch.samples.map((p) => p.after.wallUs));
    batch.reductionPercent = 100 * (1 - batch.afterMedianUs / batch.beforeMedianUs);
    report.batches.push(batch);
    process.stderr.write(`${id}/batch jobs=${jobs}: ${batch.reductionPercent.toFixed(1)}%\n`);
  }
  if (values.probe) {
    /* One measurement only; the external resource sampler owns the report. */
  } else {
    if (values.resources) {
      report.resourceProbes = [];
      for (const scenario of report.scenarios) {
        const probe = {
          game: scenario.game,
          workload: scenario.workload,
          captureLogs: scenario.captureLogs,
        };
        for (const mode of ["before", "after"]) {
          const args = [
            process.execPath,
            import.meta.filename,
            "--baseline",
            resolve(values.baseline),
            "--probe",
            mode,
            "--probe-game",
            scenario.game,
            "--probe-workload",
            scenario.workload,
          ];
          if (scenario.captureLogs) args.push("--probe-logs");
          probe[mode] = JSON.parse(
            execFileSync("python3", ["-c", RESOURCE_PROBE, ...args], { encoding: "utf8" }),
          );
        }
        report.resourceProbes.push(probe);
      }
    }
    const output = JSON.stringify(report, null, 2) + "\n";
    if (values.out) await writeFile(resolve(values.out), output);
    else process.stdout.write(output);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
