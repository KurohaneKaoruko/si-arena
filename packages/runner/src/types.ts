import type { GameCatalogEntry, GameResult, JsonObject, Replay } from "@si-arena/protocol";
import type { ReplayPlayer } from "@si-arena/engine";

export type ProcessIsolation = { kind: "local" } | { kind: "cgroup-v2"; root: string };
/** Explicit trusted registration, resolved by the caller through a public package export. */
export interface GameModule {
  url: string;
  gameExport: string;
  sdkSourceExport: string;
}
export interface RunMatchOptions {
  module: GameModule;
  manifest: GameCatalogEntry;
  matchId: string;
  seed: number;
  /** Contiguous slots in ascending order; sources use the same order. */
  players: ReplayPlayer[];
  sources: string[];
  config?: JsonObject;
  isolation: ProcessIsolation;
  replayPath?: string;
  captureLogs?: boolean;
  signal?: AbortSignal;
  onTick?(completedTicks: number): void;
  onMemory?(playerId: string, tick: number, memory: JsonObject): void;
  onMemoryTruncated?(): void;
}
export interface RunnerSummary {
  matchId: string;
  result: GameResult;
  finalStateHash: string;
  errorCount: number;
  logCount: number;
  truncatedTicks: number;
  replayData?: Readonly<Replay<unknown, unknown>>;
  metrics: {
    wallMs: number;
    cpuUs: number;
    peakRssBytes: number;
    startupMs: number;
    replayFinalizeMs: number;
    publishMs: number;
  };
}
export class RunnerSystemError extends Error {
  override name = "RunnerSystemError";
}
