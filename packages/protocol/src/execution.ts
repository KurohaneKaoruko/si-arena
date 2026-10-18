import type { JsonObject, JsonValue } from "./json";
import type { ResourceLimits } from "./resources";

export type ExecutionErrorType =
  | "RUNTIME_ERROR"
  | "CPU_LIMIT"
  | "HEAP_LIMIT"
  | "STACK_LIMIT"
  | "MEMORY_LIMIT"
  | "MEMORY_INVALID"
  | "INVALID_ACTION"
  | "ENTRYPOINT_ERROR"
  | "EXECUTION_TIMEOUT"
  | "EXECUTOR_ERROR";

export interface ExecutionError {
  type: ExecutionErrorType;
  name?: string;
  message: string;
  stack?: string;
}

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";
export interface PlayerLog {
  level: LogLevel;
  message: string;
}

export interface ExecutionIdentity {
  matchId: string;
  playerId: string;
  tick: number;
  executionId: string;
}

export interface ExecuteTickInput extends ExecutionIdentity {
  source: string;
  observation: JsonValue;
  memory: JsonObject;
  limits: ResourceLimits;
  captureLogs: boolean;
}

export type ExecuteTickResult = ExecutionIdentity &
  ({ ok: true; action: JsonValue; memory: JsonObject } | { ok: false; error: ExecutionError });
