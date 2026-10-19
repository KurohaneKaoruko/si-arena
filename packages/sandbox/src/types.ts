import type {
  ActionParseResult,
  ExecutionError,
  ExecutionIdentity,
  JsonObject,
  JsonValue,
  PlayerLog,
  ResourceLimits,
} from "@si-arena/protocol";

export type ProcessIsolation = { kind: "local" } | { kind: "cgroup-v2"; root: string };

export interface SandboxOptions<Action extends JsonValue> {
  matchId: string;
  playerId: string;
  source: string;
  /** Trusted, self-contained ESM that exports the SDK object as default. */
  sdkSource?: string;
  limits: ResourceLimits;
  isolation: ProcessIsolation;
  parseAction(raw: JsonValue): ActionParseResult<Action>;
  defaultAction: Action;
  captureLogs?: boolean;
  /** Share one budget between all players in a local match. */
  logBudget?: MatchLogBudget;
}

export class MatchLogBudget {
  private used = 0;
  constructor(readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
      throw new RangeError("Invalid match log budget");
  }
  get remainingBytes(): number {
    return this.maxBytes - this.used;
  }
  consume(bytes: number): boolean {
    if (bytes > this.remainingBytes || bytes < 0) return false;
    this.used += bytes;
    return true;
  }
}

export interface TickOutcome<Action extends JsonValue> extends ExecutionIdentity {
  ok: boolean;
  action: Action;
  memory: JsonObject;
  error?: ExecutionError;
  logs?: PlayerLog[];
  logsTruncated?: true;
  resources?: { cpuUsedUs: number; memoryBytes?: number };
}

export interface SourceValidationOptions {
  source: string;
  limits: ResourceLimits;
  isolation: ProcessIsolation;
}
export type SourceValidationResult = { ok: true } | { ok: false; error: ExecutionError };

export class SandboxSystemError extends Error {
  override name = "SandboxSystemError";
}
