import { Socket } from "node:net";
import type { ExecuteTickInput, ExecutionIdentity, ResourceLimits } from "@si-arena/protocol";
import { FramedChannel } from "./framing";
import { isRecord } from "./json";
import { compileSource, initializeRuntime, GuestSession } from "./runtime";

const limit = Number(process.argv[2]);
const executionId = process.argv[3];
if (!Number.isSafeInteger(limit) || limit <= 0 || !executionId)
  throw new Error("Invalid executor startup arguments");
const socket = new Socket({ fd: 3, readable: true, writable: true });
let initialized = false;
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
  if (
    message.kind !== "tick" ||
    !isRecord(message.input) ||
    typeof message.sdkSource !== "string" ||
    typeof message.resetEnvironment !== "boolean" ||
    typeof message.logBytes !== "number"
  )
    throw new Error("Invalid executor request");
  const input = message.input as unknown as ExecuteTickInput;
  if (
    input.executionId !== executionId ||
    typeof input.matchId !== "string" ||
    typeof input.playerId !== "string" ||
    !Number.isSafeInteger(input.tick) ||
    input.tick < 0 ||
    typeof input.source !== "string" ||
    !isRecord(input.limits) ||
    !isRecord(input.memory) ||
    typeof input.captureLogs !== "boolean"
  )
    throw new Error("Invalid tick identity or payload");
  const identity: ExecutionIdentity = {
    matchId: input.matchId,
    playerId: input.playerId,
    tick: input.tick,
    executionId,
  };
  try {
    if (message.resetEnvironment) guest.close();
    const result = guest.execute(
      input,
      message.sdkSource,
      message.logBytes,
      (log) => channel.send({ kind: "log", ...identity, log }),
      () => channel.send({ kind: "logs-truncated", ...identity }),
    );
    channel.send({ kind: "result", ...identity, ...result });
  } catch {
    channel.send({ kind: "system-error", ...identity });
  }
}
