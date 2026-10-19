export const SANDBOX_RUNTIME = "quickjs-wasm" as const;
export type { ExecuteTickInput, ExecuteTickResult, ExecutionIdentity } from "@si-arena/protocol";
export { SandboxPlayer, validateSource } from "./player";
export { MatchLogBudget, SandboxSystemError } from "./types";
export type {
  SandboxOptions,
  ProcessIsolation,
  SourceValidationOptions,
  SourceValidationResult,
  TickOutcome,
} from "./types";
