import { mkdir, mkdtemp, link, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, isAbsolute } from "node:path";
import { readReplayFile } from "@si-arena/engine/node";
import {
  cloneJson,
  snapshotJson,
  resolveResourceLimits,
  assertGameResourceLimits,
  type JsonObject,
  type ResourceLimits,
  type ExecutionError,
  type GameCatalogEntry,
  type DeepReadonly,
} from "@si-arena/protocol";
import { RunnerProcess } from "./process";
import {
  RunnerSystemError,
  type RunMatchOptions,
  type RunnerSummary,
  type ProcessIsolation,
} from "./types";
export { RunnerSystemError } from "./types";
export type { RunMatchOptions, RunnerSummary, GameModule, ProcessIsolation } from "./types";

export async function runMatchProcess(options: RunMatchOptions): Promise<RunnerSummary> {
  const dispatchedAt = performance.now();
  const { signal, onTick, onMemory, onMemoryTruncated } = options;
  const replayPath = options.replayPath;
  const isolation = snapshotJson(options.isolation);
  const captureLogs = options.captureLogs ?? false;
  if (signal?.aborted) throw new RunnerSystemError("Match cancelled");
  const binding = snapshotJson({
    module: options.module,
    matchId: options.matchId,
    seed: options.seed,
    players: options.players,
    sources: options.sources,
    ...(options.config === undefined ? {} : { config: options.config }),
  });
  const manifest = snapshotJson(options.manifest);
  const limits = resolveResourceLimits(manifest.resolvedLimits);
  assertGameResourceLimits(limits, manifest.maxPlayers);
  if (
    typeof binding.matchId !== "string" ||
    !binding.matchId.length ||
    !Number.isSafeInteger(binding.seed) ||
    binding.seed < 0 ||
    binding.seed > 0xffffffff ||
    binding.players.length < manifest.minPlayers ||
    binding.players.length > manifest.maxPlayers ||
    binding.players.some((player, slot) => player.slot !== slot)
  )
    throw new RunnerSystemError("Invalid match identity, seed or participant count");
  if (
    binding.sources.length !== binding.players.length ||
    binding.sources.some(
      (source) => typeof source !== "string" || Buffer.byteLength(source) > limits.codeBytes,
    )
  )
    throw new RangeError("Invalid or oversized player sources");
  if (replayPath && !isAbsolute(replayPath))
    throw new TypeError("Replay destination must be absolute");
  const parent = replayPath ? dirname(replayPath) : tmpdir();
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, ".arena-runner-"));
  let host: RunnerProcess | undefined;
  const cancel = () => {
    void host?.close().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    host = await RunnerProcess.start(limits, isolation, signal);
    if (signal?.aborted) throw new RunnerSystemError("Match cancelled");
    for (const [slot, source] of binding.sources.entries())
      await bindSource(host, slot, source, limits);
    const startupMs = performance.now() - dispatchedAt;
    let lastTick = 0,
      traceBytes = 0;
    const memoryTicks = new Map<string, number>();
    const message = await host.request(
      {
        kind: "run",
        request: {
          module: binding.module,
          manifest,
          matchId: binding.matchId,
          seed: binding.seed,
          players: binding.players,
          ...(binding.config === undefined ? {} : { config: binding.config }),
          replayPath: join(staging, "replay.json.gz"),
          captureLogs: captureLogs,
          captureMemory: !!onMemory,
        },
      },
      limits.startupMs + manifest.maxPlayers * limits.wallMs,
      (m) => {
        if (m.kind === "complete") return true;
        if (m.matchId !== binding.matchId)
          throw new RunnerSystemError("Mismatched match diagnostic");
        if (m.kind === "progress") {
          if (
            !Number.isSafeInteger(m.completedTicks) ||
            Number(m.completedTicks) <= lastTick ||
            Number(m.completedTicks) > manifest.maxTicks
          )
            throw new RunnerSystemError("Invalid runner progress");
          lastTick = Number(m.completedTicks);
          onTick?.(lastTick);
          return false;
        }
        if (m.kind === "memory-truncated" && onMemory) {
          onMemoryTruncated?.();
          return false;
        }
        if (
          m.kind === "memory" &&
          onMemory &&
          typeof m.playerId === "string" &&
          binding.players.some((player) => player.id === m.playerId) &&
          typeof m.text === "string" &&
          Buffer.byteLength(m.text) <= limits.memoryBytes &&
          Number.isSafeInteger(m.tick) &&
          Number(m.tick) > (memoryTicks.get(m.playerId) ?? -1) &&
          Number(m.tick) < manifest.maxTicks
        ) {
          traceBytes += Buffer.byteLength(m.text);
          if (traceBytes > 32 * 1024 * 1024)
            throw new RunnerSystemError("Memory trace exceeds match budget");
          const memory: unknown = JSON.parse(m.text);
          if (memory === null || typeof memory !== "object" || Array.isArray(memory))
            throw new RunnerSystemError("Invalid Memory diagnostic");
          memoryTicks.set(m.playerId, Number(m.tick));
          onMemory(m.playerId, Number(m.tick), cloneJson(memory) as JsonObject);
          return false;
        }
        throw new RunnerSystemError("Unexpected runner message");
      },
    );
    const summary = checkedSummary(message.summary, {
      matchId: binding.matchId,
      manifest,
      players: binding.players,
    });
    onTick?.(summary.result.completedTicks);
    if (signal?.aborted) throw new RunnerSystemError("Match cancelled");
    summary.metrics.startupMs = startupMs;
    const publishAt = performance.now();
    // The child has flushed and fsynced its candidate. Publication cannot overwrite another file.
    if (replayPath) {
      await link(join(staging, "replay.json.gz"), replayPath);
      if (process.platform !== "win32") {
        const directory = await open(parent, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } else
      summary.replayData = (await readReplayFile(join(staging, "replay.json.gz"))) as NonNullable<
        RunnerSummary["replayData"]
      >;
    summary.metrics.publishMs = performance.now() - publishAt;
    return summary;
  } finally {
    signal?.removeEventListener("abort", cancel);
    try {
      await host?.close();
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

/** ASCII frames keep arbitrary valid source text within the IPC budget, including escaped controls. */
async function bindSource(
  host: RunnerProcess,
  slot: number,
  source: string,
  limits: ResourceLimits,
): Promise<void> {
  const bytes = Buffer.from(source);
  const chunkBytes = Math.floor(((limits.ipcBytes - 1024) * 3) / 4);
  if (chunkBytes < 1) throw new RunnerSystemError("IPC budget cannot bind source chunks");
  for (let offset = 0; offset < bytes.length || offset === 0; offset += chunkBytes) {
    const complete = offset + chunkBytes >= bytes.length;
    await host.request(
      {
        kind: "source",
        slot,
        data: bytes.subarray(offset, offset + chunkBytes).toString("base64"),
        complete,
      },
      limits.startupMs,
      (m) => m.kind === "source-bound" && m.slot === slot && m.complete === complete,
    );
  }
}

function checkedSummary(
  raw: unknown,
  options: {
    matchId: string;
    manifest: DeepReadonly<GameCatalogEntry>;
    players: readonly { id: string }[];
  },
): RunnerSummary {
  const value = cloneJson(raw) as RunnerSummary;
  if (
    !value ||
    value.matchId !== options.matchId ||
    !value.result ||
    !Number.isSafeInteger(value.result.completedTicks) ||
    value.result.completedTicks < 1 ||
    value.result.completedTicks > options.manifest.maxTicks ||
    !Array.isArray(value.result.players) ||
    value.result.players.length !== options.players.length ||
    !options.players.every((player) =>
      value.result.players.some(
        (p) =>
          p.id === player.id &&
          Number.isSafeInteger(p.rank) &&
          p.rank >= 1 &&
          Number.isFinite(p.score),
      ),
    ) ||
    typeof value.finalStateHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.finalStateHash) ||
    [
      value.errorCount,
      value.logCount,
      value.truncatedTicks,
      value.metrics?.cpuUs,
      value.metrics?.peakRssBytes,
    ].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    [value.metrics?.startupMs, value.metrics?.publishMs, value.metrics?.replayFinalizeMs].some(
      (n) => !Number.isFinite(n) || n < 0,
    ) ||
    !Number.isFinite(value.metrics?.wallMs) ||
    value.metrics.wallMs < 0
  )
    throw new RunnerSystemError("Malformed match summary");
  return value;
}

export async function validateSource(options: {
  source: string;
  limits: ResourceLimits;
  isolation: ProcessIsolation;
}): Promise<{ ok: true } | { ok: false; error: ExecutionError }> {
  const source = options.source;
  const limits = resolveResourceLimits(options.limits);
  const isolation = snapshotJson(options.isolation);
  if (typeof source !== "string" || Buffer.byteLength(source) > limits.codeBytes)
    throw new RangeError("Player source exceeds code byte limit");
  const host = await RunnerProcess.start(limits, isolation);
  try {
    await bindSource(host, 0, source, limits);
    const output = await host.request(
      { kind: "validate", limits },
      limits.startupMs,
      (m) => m.kind === "validated",
    );
    if (
      typeof output.payload !== "string" ||
      Buffer.byteLength(output.payload) > limits.resultBytes
    )
      throw new RunnerSystemError("Invalid source validation output");
    const parsed: unknown = JSON.parse(output.payload);
    if (!parsed || typeof parsed !== "object" || !("ok" in parsed))
      throw new RunnerSystemError("Invalid source validation result");
    if (parsed.ok === true) return { ok: true };
    return {
      ok: false,
      error: { type: "ENTRYPOINT_ERROR", message: "Invalid or unsupported player module" },
    };
  } finally {
    await host.close();
  }
}

export { SANDBOX_RUNTIME } from "@si-arena/protocol";
