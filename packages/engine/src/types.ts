import type {
  DeepReadonly,
  ExecutionError,
  ExecutionIdentity,
  GameCatalogEntry,
  GameResult,
  GameRules,
  JsonObject,
  JsonValue,
  PlayerLog,
  Replay,
  ResourceLimits,
} from "@si-arena/protocol";

export const ENGINE_COMPATIBILITY = "si-arena-engine@1" as const;
export type ReplayPlayer = Replay<unknown, unknown>["players"][number];
export type ReplayTick<Action> = Replay<unknown, Action>["ticks"][number];
export type ReplayHeader<State> = Omit<Replay<State, never>, "ticks" | "result" | "finalStateHash">;
export interface ReplayFooter {
  result: GameResult;
  finalStateHash: string;
}
export interface StateContext {
  config: DeepReadonly<JsonObject>;
  players: readonly Readonly<ReplayPlayer>[];
}
export interface ObservationContext extends StateContext {
  playerId: string;
  tick: number;
}

export interface GameDefinition<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
> {
  manifest: GameCatalogEntry;
  rules: GameRules<State, Observation, Action, Event>;
  parseConfig(raw: unknown): JsonObject;
  parseState(raw: unknown, context: StateContext): State;
  parseObservation(raw: unknown, context: ObservationContext): Observation;
}

/** The adapter validates actions and commits Memory atomically; failures retain old Memory. */
export interface ExecutorOutcome<Action> extends ExecutionIdentity {
  ok: boolean;
  action: Action;
  error?: ExecutionError;
  logs?: PlayerLog[];
  logsTruncated?: true;
  resources?: { cpuUsedUs?: number; memoryBytes?: number };
}
export interface PlayerExecutor<Observation, Action> {
  execute(
    tick: number,
    observation: Observation,
    defaultAction: Action,
  ): Promise<ExecutorOutcome<Action>>;
  /** Must release active requests and be safe to call again. */
  close(): Promise<void>;
}
export interface ExecutorContext {
  matchId: string;
  limits: ResourceLimits;
  captureLogs: boolean;
}

export interface ReplaySink<State, Action> {
  start(header: ReplayHeader<State>): Promise<void>;
  append(tick: ReplayTick<Action>): Promise<void>;
  finish(footer: ReplayFooter): Promise<void>;
  abort(): Promise<void>;
}
export interface TickFrame<State, Action, Event> {
  state: DeepReadonly<State>;
  events: DeepReadonly<Event[]>;
  record: DeepReadonly<ReplayTick<Action>>;
}
export interface MatchOptions<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
> {
  matchId: string;
  game: GameDefinition<State, Observation, Action, Event>;
  players: ReplayPlayer[];
  seed: number;
  config?: JsonObject;
  captureLogs?: boolean;
  createExecutor(
    player: Readonly<ReplayPlayer>,
    context: ExecutorContext,
  ): Promise<PlayerExecutor<NoInfer<Observation>, NoInfer<Action>>>;
  sink: ReplaySink<NoInfer<State>, NoInfer<Action>>;
  signal?: AbortSignal;
  onTick?(frame: TickFrame<State, Action, Event>): void | Promise<void>;
}
export interface MatchSummary<State> extends ReplayFooter {
  finalState: DeepReadonly<State>;
}
export class EngineError extends Error {
  override name = "EngineError";
}
export class ReplayValidationError extends Error {
  override name = "ReplayValidationError";
}
