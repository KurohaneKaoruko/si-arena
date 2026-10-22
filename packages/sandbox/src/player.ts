import { randomUUID } from "node:crypto";
import {
  cloneJson,
  resolveResourceLimits,
  snapshotJson,
  toJsonValue,
  truncateUtf8,
  type ExecutionError,
  type ExecutionErrorType,
  type JsonObject,
  type JsonValue,
  type PlayerLog,
} from "@si-arena/protocol";
import { isRecord } from "./json";
import { GuestSession } from "./runtime";
import { MatchLogBudget, SandboxSystemError, type SandboxOptions, type TickOutcome } from "./types";

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

/** One independent isolate. Its caller must be the disposable match runner, never the API. */
export class SandboxPlayer<Action extends JsonValue> {
  private readonly guest = new GuestSession();
  private readonly limits;
  private readonly logBudget;
  private readonly fallback: Action;
  private committed = snapshotJson({}) as JsonObject;
  private busy = false;
  private closed = false;
  private lastTick = -1;
  private readonly executionId = randomUUID();

  private constructor(private readonly options: SandboxOptions<Action>) {
    this.limits = snapshotJson(resolveResourceLimits(options.limits));
    if (!options.matchId || !options.playerId)
      throw new TypeError("Match and player identities are required");
    if (
      typeof options.source !== "string" ||
      Buffer.byteLength(options.source) > this.limits.codeBytes
    )
      throw new RangeError("Player source exceeds code byte limit");
    if (
      typeof options.sdkSource !== "string" ||
      !options.sdkSource.length ||
      Buffer.byteLength(options.sdkSource) > this.limits.codeBytes
    )
      throw new TypeError("Trusted SDK is missing or exceeds input budget");
    this.fallback = snapshotJson(options.defaultAction, this.limits.actionBytes) as Action;
    this.logBudget = options.logBudget ?? new MatchLogBudget(this.limits.logs.matchBytes);
    if (this.logBudget.maxBytes > this.limits.logs.matchBytes)
      throw new SandboxSystemError("Match log budget exceeds release limit");
    this.guest.prepareSource(options.source);
  }

  static async create<Action extends JsonValue>(
    options: SandboxOptions<Action>,
  ): Promise<SandboxPlayer<Action>> {
    return new SandboxPlayer(options);
  }

  get memorySnapshot() {
    return this.committed;
  }

  get memory(): JsonObject {
    return cloneJson(this.committed);
  }

  async execute(
    tick: number,
    observation: unknown,
    defaultAction: Action = this.fallback,
  ): Promise<TickOutcome<Action>> {
    if (this.closed) throw new SandboxSystemError("Player executor is closed");
    if (this.busy) throw new SandboxSystemError("Concurrent ticks for one player are forbidden");
    if (!Number.isSafeInteger(tick) || tick < 0 || tick <= this.lastTick)
      throw new SandboxSystemError("Ticks must be non-negative and strictly increasing");
    let observed: JsonValue;
    let fallback: Action;
    try {
      observed = snapshotJson(observation, this.limits.observationBytes) as JsonValue;
      fallback = snapshotJson(defaultAction, this.limits.actionBytes) as Action;
    } catch {
      throw new SandboxSystemError("Observation is invalid or exceeds release budget");
    }
    this.busy = true;
    this.lastTick = tick;
    const identity = {
      matchId: this.options.matchId,
      playerId: this.options.playerId,
      tick,
      executionId: this.executionId,
    };
    const logs: PlayerLog[] = [];
    let logsTruncated = false;
    let logBytes = 0;
    const finish = (result: Omit<TickOutcome<Action>, "memory">): TickOutcome<Action> => {
      // Diagnostics are detached on demand, never cloned along the ordinary engine path.
      const committed = this.committed;
      return {
        ...result,
        get memory() {
          return cloneJson(committed);
        },
      };
    };
    const fail = (error: ExecutionError, cpuUsedUs?: number): TickOutcome<Action> => {
      this.guest.close();
      return finish({
        ...identity,
        ok: false,
        action: cloneJson(fallback),
        error,
        ...(cpuUsedUs === undefined ? {} : { resources: { cpuUsedUs } }),
        ...(this.options.captureLogs
          ? { logs, ...(logsTruncated ? { logsTruncated: true as const } : {}) }
          : {}),
      });
    };
    try {
      const result = await this.guest.execute(
        {
          ...identity,
          source: this.options.source,
          observation: observed,
          memory: this.committed,
          limits: this.limits,
          captureLogs: this.options.captureLogs ?? false,
        },
        this.options.sdkSource,
        Math.min(this.limits.logs.tickBytes, this.logBudget.remainingBytes),
        (log) => {
          const bytes = Buffer.byteLength(log.message);
          if (!this.options.captureLogs || bytes > this.limits.logs.lineBytes)
            throw new SandboxSystemError("Unexpected trusted logger output");
          if (
            logs.length >= this.limits.logs.tickLines ||
            logBytes + bytes > this.limits.logs.tickBytes ||
            !this.logBudget.consume(bytes)
          )
            logsTruncated = true;
          else {
            logs.push(log);
            logBytes += bytes;
          }
        },
        () => {
          logsTruncated = true;
        },
      );
      if (
        Buffer.byteLength(result.payload) > this.limits.resultBytes ||
        !Number.isSafeInteger(result.cpuUsedUs) ||
        result.cpuUsedUs < 0
      )
        throw new SandboxSystemError("Malformed isolate result");
      const output: unknown = JSON.parse(result.payload);
      if (!isRecord(output) || typeof output.ok !== "boolean")
        throw new SandboxSystemError("Invalid execution output");
      logsTruncated ||= output.logsTruncated === true;
      if (!output.ok) {
        const error = output.error;
        if (
          !isRecord(error) ||
          !ERROR_TYPES.has(error.type as ExecutionErrorType) ||
          typeof error.message !== "string" ||
          Buffer.byteLength(JSON.stringify(error)) > this.limits.errorBytes ||
          (error.name !== undefined && typeof error.name !== "string") ||
          (error.stack !== undefined && typeof error.stack !== "string")
        )
          throw new SandboxSystemError("Invalid bounded error diagnostic");
        return fail(error as unknown as ExecutionError, result.cpuUsedUs);
      }
      if (result.cpuUsedUs > this.limits.cpuMs * 1000)
        return fail({ type: "CPU_LIMIT", message: "Tick CPU budget exceeded" }, result.cpuUsedUs);
      let memory: JsonObject;
      let action: JsonValue;
      try {
        if (!isRecord(output.memory)) throw new Error("Invalid root");
        memory = snapshotJson(output.memory, this.limits.memoryBytes) as JsonObject;
      } catch {
        return fail(
          { type: "MEMORY_INVALID", message: "Candidate Memory failed validation" },
          result.cpuUsedUs,
        );
      }
      try {
        action = toJsonValue(output.action, this.limits.actionBytes);
      } catch {
        return fail(
          { type: "INVALID_ACTION", message: "Action failed JSON validation" },
          result.cpuUsedUs,
        );
      }
      const parsed = this.options.parseAction(action);
      if (!parsed.ok)
        return fail(
          {
            type: "INVALID_ACTION",
            message: truncateUtf8(parsed.message, this.limits.errorBytes >> 3),
          },
          result.cpuUsedUs,
        );
      const normalized = cloneJson(parsed.action, this.limits.actionBytes);
      this.committed = memory;
      return finish({
        ...identity,
        ok: true,
        action: normalized,
        resources: { cpuUsedUs: result.cpuUsedUs },
        ...(this.options.captureLogs
          ? { logs, ...(logsTruncated ? { logsTruncated: true as const } : {}) }
          : {}),
      });
    } catch (error) {
      this.guest.close();
      if (error instanceof SandboxSystemError) throw error;
      throw new SandboxSystemError(
        error instanceof Error ? error.message : "Trusted sandbox runtime failed",
      );
    } finally {
      this.busy = false;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.guest.close();
  }
}
