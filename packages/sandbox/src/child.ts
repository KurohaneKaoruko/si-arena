import { Socket } from "node:net";
import { setFlagsFromString } from "node:v8";
import type { ExecuteTickInput, ExecutionIdentity, ResourceLimits } from "@si-arena/protocol";
import { FramedChannel } from "./framing";
import type { ExecutorBinding } from "./process";
import { isRecord } from "./json";
import { compileSource, initializeRuntime, GuestSession } from "./runtime";

// Let hot QuickJS WASM functions reach the optimizing tier during the startup
// warm-up instead of inside a billed tick. An unknown flag is ignored, so a V8
// that renames it only loses the speed-up.
try {
  setFlagsFromString("--wasm-tiering-budget=200000");
} catch {
  // Keep the default tiering.
}

const limit = Number(process.argv[2]);
const executionId = process.argv[3];
if (!Number.isSafeInteger(limit) || limit <= 0 || !executionId)
  throw new Error("Invalid executor startup arguments");
const socket = new Socket({ fd: 3, readable: true, writable: true });
let initialized = false;
let binding: ExecutorBinding | undefined;
let busy = false;
const guest = new GuestSession();
const channel = new FramedChannel(
  socket,
  limit,
  (message) => {
    if (!isRecord(message) || busy) {
      channel.close();
      return;
    }
    busy = true;
    void dispatch(message)
      .catch(() => channel.close())
      .finally(() => {
        busy = false;
      });
  },
  () => {
    channel.close();
    process.exitCode = 1;
  },
);
socket.on("end", () => channel.close());

async function dispatch(message: Record<string, unknown>): Promise<void> {
  if (message.kind === "initialize" && !initialized && message.executionId === executionId) {
    try {
      await initializeRuntime();
      initialized = true;
      channel.send({ kind: "ready", executionId });
    } catch {
      channel.send({ kind: "system-error", executionId });
    }
    return;
  }
  if (!initialized) throw new Error("Executor is not ready");
  if (
    message.kind === "validate" &&
    typeof message.validationId === "string" &&
    typeof message.source === "string" &&
    isRecord(message.limits)
  ) {
    const identity = { validationId: message.validationId, executionId };
    try {
      channel.send({
        kind: "validation-result",
        ...identity,
        ...compileSource(message.source, message.limits as unknown as ResourceLimits),
      });
    } catch {
      channel.send({ kind: "system-error", ...identity });
    }
    return;
  }
  if (message.kind === "bind" && !binding && message.executionId === executionId) {
    if (
      typeof message.matchId !== "string" ||
      typeof message.playerId !== "string" ||
      typeof message.source !== "string" ||
      typeof message.sdkSource !== "string" ||
      !isRecord(message.limits) ||
      typeof message.captureLogs !== "boolean"
    )
      throw new Error("Invalid executor binding");
    binding = {
      matchId: message.matchId,
      playerId: message.playerId,
      source: message.source,
      sdkSource: message.sdkSource,
      limits: message.limits as unknown as ResourceLimits,
      captureLogs: message.captureLogs,
    };
    channel.send({ kind: "bound", executionId });
    return;
  }
  if (
    message.kind !== "tick" ||
    !binding ||
    !isRecord(message.input) ||
    typeof message.resetEnvironment !== "boolean" ||
    typeof message.logBytes !== "number"
  )
    throw new Error("Invalid executor request");
  const tick = message.input;
  if (
    tick.executionId !== executionId ||
    tick.matchId !== binding.matchId ||
    tick.playerId !== binding.playerId ||
    !Number.isSafeInteger(tick.tick) ||
    Number(tick.tick) < 0 ||
    !isRecord(tick.memory)
  )
    throw new Error("Invalid tick identity or payload");
  const input = {
    ...tick,
    source: binding.source,
    limits: binding.limits,
    captureLogs: binding.captureLogs,
  } as unknown as ExecuteTickInput;
  const identity: ExecutionIdentity = {
    matchId: input.matchId,
    playerId: input.playerId,
    tick: input.tick,
    executionId: input.executionId,
  };
  try {
    if (message.resetEnvironment) guest.close();
    const result = guest.execute(
      input,
      binding.sdkSource,
      message.logBytes,
      (log) => channel.send({ kind: "log", ...identity, log }),
      () => channel.send({ kind: "logs-truncated", ...identity }),
    );
    channel.send({ kind: "result", ...identity, ...result });
  } catch {
    channel.send({ kind: "system-error", ...identity });
  }
}
