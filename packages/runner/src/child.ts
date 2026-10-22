import { Socket } from "node:net";
import { runMatch, type GameDefinition, type ReplayFooter } from "@si-arena/engine";
import { ReplayFileSink } from "@si-arena/engine/node";
import {
  cloneJson,
  resolveResourceLimits,
  stringifyJson,
  truncateUtf8,
  type GameCatalogEntry,
  type JsonObject,
  type JsonValue,
} from "@si-arena/protocol";
import { SandboxPlayer, MatchLogBudget, compileSource } from "@si-arena/sandbox";
import { FramedChannel } from "./framing";

class MatchReplaySink extends ReplayFileSink<{ tick: number }, JsonValue> {
  finalizeMs = 0;
  override async finish(footer: ReplayFooter): Promise<void> {
    const start = performance.now();
    try {
      await super.finish(footer);
    } finally {
      this.finalizeMs = performance.now() - start;
    }
  }
}

const ipcBytes = Number(process.argv[2]);
const executionId = process.argv[3];
if (!Number.isSafeInteger(ipcBytes) || ipcBytes <= 0 || !executionId)
  throw new Error("Invalid runner startup arguments");
const socket = new Socket({ fd: 3, readable: true, writable: true });
const sourceTexts: string[] = [];
let sourceChunks: Buffer[] = [];
let sourceBytes = 0,
  codeBytes = 0;
let initialized = false,
  busy = false;
const channel = new FramedChannel(
  socket,
  ipcBytes,
  (message) => {
    if (!isRecord(message) || message.executionId !== executionId || busy) {
      channel.close();
      return;
    }
    busy = true;
    void dispatch(message)
      .catch(async (error) => {
        try {
          await send({
            kind: "system-error",
            message: truncateUtf8(
              error instanceof Error ? error.message : "Trusted match execution failed",
              2048,
            ),
          });
        } catch {
          process.exitCode = 1;
          channel.close();
        }
      })
      .finally(() => {
        busy = false;
      });
  },
  () => {
    process.exitCode = 1;
    socket.destroy();
  },
);
socket.on("end", () => {
  channel.close();
  process.exit(1);
});
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function send(message: Record<string, unknown>): Promise<void> {
  return channel.sendAndDrain({ ...message, executionId });
}
async function dispatch(message: Record<string, unknown>): Promise<void> {
  if (message.kind === "initialize" && !initialized) {
    if (!Number.isSafeInteger(message.codeBytes) || Number(message.codeBytes) <= 0)
      throw new Error("Invalid source budget");
    codeBytes = Number(message.codeBytes);
    initialized = true;
    await send({ kind: "ready" });
    return;
  }
  if (!initialized) throw new Error("Runner is not initialized");
  if (message.kind === "validate") {
    if (sourceTexts.length !== 1 || sourceBytes !== 0 || !isRecord(message.limits))
      throw new Error("Invalid validation request");
    const limits = resolveResourceLimits(message.limits);
    if (Buffer.byteLength(sourceTexts[0]!) > limits.codeBytes)
      throw new Error("Player source exceeds code byte limit");
    await send({ kind: "validated", ...compileSource(sourceTexts[0]!, limits) });
    return;
  }
  if (
    message.kind === "source" &&
    Number.isSafeInteger(message.slot) &&
    message.slot === sourceTexts.length &&
    typeof message.data === "string" &&
    typeof message.complete === "boolean"
  ) {
    const chunk = Buffer.from(message.data, "base64");
    if (chunk.toString("base64") !== message.data) throw new Error("Invalid source chunk encoding");
    sourceBytes += chunk.byteLength;
    if (sourceBytes > codeBytes) throw new Error("Oversized source");
    sourceChunks.push(chunk);
    if (message.complete) {
      sourceTexts.push(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(sourceChunks, sourceBytes)),
      );
      sourceChunks = [];
      sourceBytes = 0;
    }
    await send({ kind: "source-bound", slot: message.slot, complete: message.complete });
    return;
  }
  if (message.kind !== "run" || !isRecord(message.request))
    throw new Error("Invalid runner request");
  const request = message.request;
  if (
    !isRecord(request.module) ||
    typeof request.module.url !== "string" ||
    !request.module.url.startsWith("file:") ||
    typeof request.module.gameExport !== "string" ||
    typeof request.module.sdkSourceExport !== "string" ||
    !isRecord(request.manifest) ||
    !Array.isArray(request.players) ||
    typeof request.matchId !== "string" ||
    typeof request.replayPath !== "string"
  )
    throw new Error("Invalid match binding");
  const manifest = cloneJson(request.manifest) as unknown as GameCatalogEntry;
  const limits = resolveResourceLimits(manifest.resolvedLimits);
  if (
    sourceTexts.length !== request.players.length ||
    sourceTexts.some((source) => Buffer.byteLength(source) > limits.codeBytes)
  )
    throw new Error("Invalid player source bindings");
  // This URL comes only from the caller's explicit trusted registration, never player or replay data.
  const loaded: Record<string, unknown> = await import(request.module.url);
  const candidate = loaded[request.module.gameExport];
  const sdkSource = loaded[request.module.sdkSourceExport];
  if (
    !isRecord(candidate) ||
    typeof sdkSource !== "string" ||
    !isRecord(candidate.manifest) ||
    candidate.manifest.id !== manifest.id ||
    candidate.manifest.release !== manifest.release ||
    candidate.manifest.botProtocolVersion !== manifest.botProtocolVersion
  )
    throw new Error("Trusted game module differs from frozen release");
  const game = { ...candidate, manifest } as unknown as GameDefinition<
    { tick: number },
    JsonValue,
    JsonValue,
    JsonValue
  >;
  const players = cloneJson(request.players) as Array<{
    id: string;
    slot: number;
    name: string;
    official: boolean;
  }>;
  const logBudget = new MatchLogBudget(limits.logs.matchBytes);
  const instances = new Map<string, SandboxPlayer<JsonValue>>();
  const trace = new Map<string, string>();
  let traceBytes = 0,
    traceTruncated = false;
  let errorCount = 0,
    logCount = 0,
    truncatedTicks = 0,
    lastProgress = performance.now();
  const startedAt = performance.now(),
    cpu = process.cpuUsage();
  const sink = new MatchReplaySink(request.replayPath);
  const summary = await runMatch({
    game,
    matchId: request.matchId,
    players,
    seed: Number(request.seed),
    ...(request.config === undefined ? {} : { config: cloneJson(request.config) as JsonObject }),
    captureLogs: request.captureLogs === true,
    sink,
    async createExecutor(player, context) {
      let pending: Promise<SandboxPlayer<JsonValue>> | undefined;
      return {
        async execute(tick, observation, defaultAction) {
          pending ??= SandboxPlayer.create({
            ...context,
            playerId: player.id,
            source: sourceTexts[player.slot]!,
            sdkSource,
            parseAction: game.rules.parseAction,
            defaultAction,
            logBudget,
          });
          const instance = await pending;
          instances.set(player.id, instance);
          return instance.execute(tick, observation, defaultAction);
        },
        async close() {
          await (await pending)?.close();
        },
      };
    },
    async onTick({ record }) {
      errorCount += Object.keys(record.errors ?? {}).length;
      logCount += Object.values(record.logs ?? {}).reduce((sum, logs) => sum + logs.length, 0);
      if (Object.keys(record.logsTruncated ?? {}).length) truncatedTicks++;
      if (request.captureMemory === true && !traceTruncated) {
        for (const [playerId, instance] of instances) {
          const text = stringifyJson(instance.memorySnapshot);
          if (trace.get(playerId) === text) continue;
          const bytes = Buffer.byteLength(text);
          if (
            traceBytes + bytes > 32 * 1024 * 1024 ||
            Buffer.byteLength(JSON.stringify(text)) + 4096 > ipcBytes
          ) {
            traceTruncated = true;
            await send({ kind: "memory-truncated", matchId: request.matchId });
            break;
          }
          traceBytes += bytes;
          trace.set(playerId, text);
          await send({
            kind: "memory",
            matchId: request.matchId,
            playerId,
            tick: record.tick,
            text,
          });
        }
      }
      if (record.tick % 16 === 0 || performance.now() - lastProgress >= 100) {
        lastProgress = performance.now();
        await send({ kind: "progress", matchId: request.matchId, completedTicks: record.tick + 1 });
      }
    },
  });
  const used = process.cpuUsage(cpu);
  await send({
    kind: "complete",
    summary: {
      matchId: request.matchId,
      result: summary.result,
      finalStateHash: summary.finalStateHash,
      errorCount,
      logCount,
      truncatedTicks,
      metrics: {
        wallMs: performance.now() - startedAt,
        cpuUs: used.user + used.system,
        startupMs: 0,
        publishMs: 0,
        replayFinalizeMs: sink.finalizeMs,
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
      },
    },
  });
}
