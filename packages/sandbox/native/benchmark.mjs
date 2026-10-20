import { cpus, platform, arch } from "node:os";
import { initializeRuntime, GuestSession } from "../dist/runtime.js";
import { SandboxPlayer } from "../dist/index.js";
import { resolveResourceLimits } from "@si-arena/protocol";

const limits = resolveResourceLimits();
const source = "export default ({Memory})=>{Memory.n=(Memory.n??0)+1;}";
// Approximate the two 40x30 Paper grids, without importing a game into the sandbox package.
const observation = {
  tick: 0,
  territory: Array.from({ length: 1200 }, () => null),
  trails: Array.from({ length: 1200 }, () => null),
};
await initializeRuntime();
const samples = [];
const session = new GuestSession();
for (let tick = 0; tick < 105; tick++) {
  const output = session.execute(
    {
      matchId: "benchmark",
      playerId: "one",
      executionId: "direct",
      tick,
      source,
      observation,
      memory: { n: tick },
      limits,
      captureLogs: false,
    },
    "export default (o,{submit})=>{submit({type:'idle'});return o}",
    0,
    () => {},
    () => {},
  );
  const result = JSON.parse(output.payload);
  if (!result.ok) throw new Error(JSON.stringify(result));
  if (tick >= 5) samples.push(output);
}
session.close();
const player = await SandboxPlayer.create({
  matchId: "benchmark",
  playerId: "one",
  source,
  sdkSource: "export default (o,{submit})=>{submit({type:'idle'});return o}",
  limits,
  isolation: { kind: "local" },
  defaultAction: { type: "idle" },
  parseAction: (action) => ({ ok: true, action }),
});
const wallUs = [],
  playerCpuUs = [];
try {
  for (let tick = 0; tick < 105; tick++) {
    const started = performance.now();
    const result = await player.execute(tick, observation);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    if (tick >= 5) {
      wallUs.push((performance.now() - started) * 1000);
      playerCpuUs.push(result.resources.cpuUsedUs);
    }
  }
} finally {
  await player.close();
}
const summary = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    p95: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
  };
};
console.log(
  JSON.stringify(
    {
      node: process.version,
      quickjsEmscripten: "0.32.0",
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0].model,
      samples: 100,
      units: "microseconds",
      playerCpu: summary(playerCpuUs),
      roundTripWall: summary(wallUs),
      phases: Object.fromEntries(
        Object.keys(samples[0].profile).map((key) => [
          key,
          summary(samples.map((sample) => sample.profile[key])),
        ]),
      ),
      note: "Local microbenchmark, 5 warm-up ticks excluded. playerCpu is the billed player CPU: source evaluation on initialization/rebuild only, entry call and action/Memory serialization, SDK calls included; the trusted sandbox setup is platform overhead and is not billed against the player budget. phases is the thread CPU breakdown of the in-process run and still contains that trusted setup. roundTripWall includes IPC, host validation, scheduling and teardown; it is not player CPU.",
    },
    null,
    2,
  ),
);
