export const SANDBOX_RUNTIME = "v8-isolate" as const;
export type { ExecuteTickInput, ExecuteTickResult, ExecutionIdentity } from "@si-arena/protocol";
export { SandboxPlayer, validateSource } from "./player";
export { createSandboxExecutor } from "./executor";
export { MatchLogBudget, SandboxSystemError } from "./types";
export type {
  SandboxOptions,
  ProcessIsolation,
  SourceValidationOptions,
  SourceValidationResult,
  TickOutcome,
} from "./types";
