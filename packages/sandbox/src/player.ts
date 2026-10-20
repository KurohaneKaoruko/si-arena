import { randomUUID } from "node:crypto";
import {
  cloneJson,
  resolveResourceLimits,
  toJsonValue,
  truncateUtf8,
  type ExecuteTickInput,
  type ExecutionError,
  type ExecutionErrorType,
  type ExecutionIdentity,
  type JsonObject,
  type JsonValue,
  type PlayerLog,
  type ResourceLimits,
} from "@si-arena/protocol";
import { isRecord } from "./json";
import { ExecutorProcess, ExecutorStopped } from "./process";
import {
  MatchLogBudget,
  SandboxSystemError,
  type SandboxOptions,
  type SourceValidationOptions,
  type SourceValidationResult,
  type TickOutcome,
} from "./types";

const ERROR_TYPES = new Set<ExecutionErrorType>([
  "RUNTIME_ERROR",
  "CPU_LIMIT",
  "HEAP_LIMIT",
  "STACK_LIMIT",
  "MEMORY_LIMIT",
  "MEMORY_INVALID",
  "INVALID_ACTION",
  "ENTRYPOINT_ERROR",
  "EXECUTION_TIMEOUT",
  "EXECUTOR_ERROR",
]);
const LEVELS = new Set(["log", "info", "warn", "error", "debug"]);

export class SandboxPlayer<Action extends JsonValue> {
  private executor: ExecutorProcess | undefined;
  private rebuilding: Promise<void> | undefined;
  private committed: JsonObject = {};
  private busy = false;
  private closed = false;
  private lastTick = -1;
  private resetEnvironment = false;
  private readonly limits: ResourceLimits;
  private readonly source: string;
  private readonly sdkSource: string;
  private readonly logBudget: MatchLogBudget;
  private readonly fallback: Action;

  private constructor(private readonly options: SandboxOptions<Action>) {
    this.limits = checkedLimits(options.limits);
    assertSource(options.source, this.limits);
    if (!options.matchId || !options.playerId)
      throw new TypeError("Match and player identities are required");
    this.source = options.source;
    this.sdkSource = options.sdkSource;
    if (Buffer.byteLength(this.sdkSource) > this.limits.codeBytes)
      throw new SandboxSystemError("Trusted SDK exceeds input budget");
    this.logBudget = options.logBudget ?? new MatchLogBudget(this.limits.logs.matchBytes);
    if (this.logBudget.maxBytes > this.limits.logs.matchBytes)
      throw new SandboxSystemError("Match log budget exceeds release limit");
    this.fallback = cloneJson(options.defaultAction, this.limits.actionBytes);
  }

  static async create<Action extends JsonValue>(
    options: SandboxOptions<Action>,
  ): Promise<SandboxPlayer<Action>> {
    const player = new SandboxPlayer(options);
    player.executor = await ExecutorProcess.start(player.limits, options.isolation);
    return player;
  }

  get memory(): JsonObject {
    return cloneJson(this.committed, this.limits.memoryBytes);
  }
  get processId(): number | undefined {
    return this.executor?.pid;
  }

  async execute(
    tick: number,
    observation: unknown,
    defaultAction: Action = this.fallback,
  ): Promise<TickOutcome<Action>> {
    if (this.closed) throw new SandboxSystemError("Player executor is closed");
    if (this.busy) throw new SandboxSystemError("Concurrent ticks for one player are forbidden");
    if (!Number.isSafeInteger(tick) || tick <= this.lastTick)
      throw new SandboxSystemError("Ticks must be non-negative and strictly increasing");
    // Trusted world data exceeding its budget is a system failure, never player misconduct.
    let observed: JsonValue;
    let fallback: Action;
    try {
      observed = toJsonValue(observation, this.limits.observationBytes);
      fallback = cloneJson(defaultAction, this.limits.actionBytes);
    } catch {
      throw new SandboxSystemError("Observation is invalid or exceeds release budget");
    }
    const dispatchedAt = performance.now();
    this.busy = true;
    this.lastTick = tick;
    const logs: PlayerLog[] = [];
    let logsTruncated = false,
      logBytes = 0;
    let identity: ExecutionIdentity = {
      matchId: this.options.matchId,
      playerId: this.options.playerId,
      tick,
      executionId: this.executor?.id ?? randomUUID(),
    };
    const failed = (error: ExecutionError): TickOutcome<Action> => {
      this.resetEnvironment = true;
      return {
        ...identity,
        ok: false,
        action: cloneJson(fallback, this.limits.actionBytes),
        memory: this.memory,
        error,
        ...(this.options.captureLogs
          ? { logs, ...(logsTruncated ? { logsTruncated: true as const } : {}) }
          : {}),
      };
    };
    try {
      if (this.rebuilding) {
        await Promise.race([
          this.rebuilding,
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.limits.wallMs);
            timer.unref();
          }),
        ]);
      }
      // A failed rebuild leaves the executor unusable, so the next tick takes
      // the restart path again: transient spawn failures cost one tick each and
      // never wedge the player for the rest of the match.
      const executor = this.executor;
      if (!executor?.usable) {
        this.rebuild();
        return failed({ type: "EXECUTOR_ERROR", message: "Player executor is restarting" });
      }
      identity = { ...identity, executionId: executor.id };
      const input: ExecuteTickInput = {
        ...identity,
        source: this.source,
        observation: observed,
        memory: this.committed,
        limits: this.limits,
        captureLogs: this.options.captureLogs ?? false,
      };
      const request = {
        kind: "tick",
        resetEnvironment: this.resetEnvironment,
        input,
        sdkSource: this.sdkSource,
        logBytes: Math.min(this.limits.logs.tickBytes, this.logBudget.remainingBytes),
      };
      if (Buffer.byteLength(JSON.stringify(request)) > this.limits.ipcBytes)
        throw new SandboxSystemError("Trusted tick envelope exceeds IPC budget");
      let message: Record<string, unknown>;
      try {
        message = await executor.request(
          request,
          Math.max(1, this.limits.wallMs - (performance.now() - dispatchedAt)),
          (value) => {
            if (!matches(value, identity)) return false;
            if (value.kind === "system-error")
              throw new SandboxSystemError("Trusted sandbox runtime failed");
            if (value.kind === "logs-truncated") {
              if (!this.options.captureLogs)
                throw new SandboxSystemError("Unexpected log metadata");
              logsTruncated = true;
              return false;
            }
            if (value.kind === "log") {
              const log = value.log;
              if (
                !isRecord(log) ||
                typeof log.level !== "string" ||
                !LEVELS.has(log.level) ||
                typeof log.message !== "string"
              )
                throw new SandboxSystemError("Malformed log frame");
              const bytes = Buffer.byteLength(log.message);
              if (!this.options.captureLogs || bytes > this.limits.logs.lineBytes)
                throw new SandboxSystemError("Unexpected or oversized log frame");
              if (
                logs.length >= this.limits.logs.tickLines ||
                logBytes + bytes > this.limits.logs.tickBytes ||
                !this.logBudget.consume(bytes)
              )
                logsTruncated = true;
              else {
                logs.push({ level: log.level as PlayerLog["level"], message: log.message });
                logBytes += bytes;
              }
              return false;
            }
            if (value.kind !== "result")
              throw new SandboxSystemError("Unexpected executor message");
            return true;
          },
        );
      } catch (error) {
        this.rebuild();
        if (!(error instanceof ExecutorStopped)) throw error;
        return failed({
          type: error.reason,
          message:
            error.reason === "EXECUTION_TIMEOUT"
              ? "Tick wall time exceeded"
              : "Player executor stopped",
        });
      }
      if (
        typeof message.payload !== "string" ||
        Buffer.byteLength(message.payload) > this.limits.resultBytes ||
        !Number.isSafeInteger(message.cpuUsedUs) ||
        Number(message.cpuUsedUs) < 0
      )
        throw new SandboxSystemError("Malformed executor result");
      this.resetEnvironment = false;
      const output: unknown = JSON.parse(message.payload);
      if (!isRecord(output) || typeof output.ok !== "boolean")
        throw new SandboxSystemError("Invalid execution output");
      logsTruncated ||= output.logsTruncated === true;
      const resources = { cpuUsedUs: Number(message.cpuUsedUs) };
      if (!output.ok) return { ...failed(parseError(output.error, this.limits)), resources };
      if (resources.cpuUsedUs > this.limits.cpuMs * 1000)
        return { ...failed({ type: "CPU_LIMIT", message: "Tick CPU budget exceeded" }), resources };
      if (!isRecord(output.memory)) throw new SandboxSystemError("Malformed candidate Memory");
      let memory: JsonObject;
      let action: JsonValue;
      try {
        memory = toJsonValue(output.memory, this.limits.memoryBytes) as JsonObject;
      } catch {
        return {
          ...failed({ type: "MEMORY_INVALID", message: "Candidate Memory failed validation" }),
          resources,
        };
      }
      try {
        action = toJsonValue(output.action, this.limits.actionBytes);
      } catch {
        return {
          ...failed({ type: "INVALID_ACTION", message: "Action failed JSON validation" }),
          resources,
        };
      }
      // A throwing trusted game parser is a system failure. Do not hide it as player error.
      const parsed = this.options.parseAction(action);
      if (!parsed.ok)
        return {
          ...failed({
            type: "INVALID_ACTION",
            message: truncateUtf8(parsed.message, (this.limits.errorBytes / 8) | 0),
          }),
          resources,
        };
      const normalized = cloneJson(parsed.action, this.limits.actionBytes);
      this.committed = memory;
      return {
        ...identity,
        ok: true,
        action: normalized,
        memory: this.memory,
        resources,
        ...(this.options.captureLogs
          ? { logs, ...(logsTruncated ? { logsTruncated: true as const } : {}) }
          : {}),
      };
    } finally {
      this.busy = false;
    }
  }

  private rebuild(): void {
    if (this.closed || this.rebuilding) return;
    const old = this.executor;
    this.executor = undefined;
    this.rebuilding = (async () => {
      await old?.close();
      if (this.closed) return;
      this.executor = await ExecutorProcess.start(this.limits, this.options.isolation);
      if (this.closed) {
        await this.executor.close();
        this.executor = undefined;
      }
    })()
      .catch(() => {
        // Spawn failures are per-tick by design; the next execute retries via
        // the unusable-executor path. Swallowing keeps close() rejection-free.
      })
      .finally(() => {
        this.rebuilding = undefined;
      });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.executor?.close();
    await this.rebuilding;
    this.executor = undefined;
  }
}

export async function validateSource(
  options: SourceValidationOptions,
): Promise<SourceValidationResult> {
  const limits = checkedLimits(options.limits);
  assertSource(options.source, limits);
  const executor = await ExecutorProcess.start(limits, options.isolation);
  const validationId = randomUUID();
  try {
    const message = await executor.request(
      { kind: "validate", validationId, executionId: executor.id, source: options.source, limits },
      limits.wallMs,
      (value) => {
        if (value.validationId !== validationId || value.executionId !== executor.id) return false;
        if (value.kind !== "validation-result")
          throw new SandboxSystemError("Source validation executor failed");
        return true;
      },
    );
    if (
      typeof message.payload !== "string" ||
      Buffer.byteLength(message.payload) > limits.resultBytes
    )
      throw new SandboxSystemError("Invalid validation output");
    const output: unknown = JSON.parse(message.payload);
    if (!isRecord(output)) throw new SandboxSystemError("Invalid validation result");
    return output.ok === true
      ? { ok: true }
      : { ok: false, error: parseError(output.error, limits) };
  } catch (error) {
    if (!(error instanceof ExecutorStopped)) throw error;
    return {
      ok: false,
      error: { type: error.reason, message: "Source validation executor stopped" },
    };
  } finally {
    await executor.close();
  }
}

function checkedLimits(limits: ResourceLimits): ResourceLimits {
  const resolved = resolveResourceLimits(limits);
  Object.freeze(resolved.logs);
  return Object.freeze(resolved);
}
function assertSource(source: string, limits: ResourceLimits): void {
  if (typeof source !== "string" || Buffer.byteLength(source) > limits.codeBytes)
    throw new RangeError("Player source exceeds code byte limit");
}
function matches(message: Record<string, unknown>, identity: ExecutionIdentity): boolean {
  return (
    message.matchId === identity.matchId &&
    message.playerId === identity.playerId &&
    message.tick === identity.tick &&
    message.executionId === identity.executionId
  );
}
function parseError(value: unknown, limits: ResourceLimits): ExecutionError {
  if (
    !isRecord(value) ||
    !ERROR_TYPES.has(value.type as ExecutionErrorType) ||
    typeof value.message !== "string" ||
    Buffer.byteLength(JSON.stringify(value)) > limits.errorBytes ||
    (value.name !== undefined && typeof value.name !== "string") ||
    (value.stack !== undefined && typeof value.stack !== "string")
  )
    throw new SandboxSystemError("Invalid bounded error diagnostic");
  return {
    type: value.type as ExecutionErrorType,
    message: value.message,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.stack === "string" ? { stack: value.stack } : {}),
  };
}
