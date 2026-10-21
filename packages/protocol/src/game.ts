import type { DeepReadonly, JsonObject, JsonValue } from "./json";
import type { ResourceLimitOverrides, ResourceLimits } from "./resources";

/** A single shared arena fed by the game's own leaderboard (for example a battle royale). */
export interface ArenaSettings {
  /** Seats filled from the leaderboard when a run starts. */
  seats: number;
  /** Finished runs kept with their replays; older runs are deleted. */
  keepMatches: number;
  /** Points by finishing rank, index 0 for rank 1; later ranks score 0. */
  points: number[];
  /** Game whose rating breaks ties between equal points. */
  tieBreakGameId?: string;
}

export interface GameManifest {
  id: string;
  name: string;
  description: string;
  release: string;
  botProtocolVersion: number;
  minPlayers: number;
  maxPlayers: number;
  maxTicks: number;
  config: JsonObject;
  limits?: ResourceLimitOverrides;
  arena?: ArenaSettings;
}

export interface GameCatalogEntry extends Omit<GameManifest, "limits"> {
  resolvedLimits: ResourceLimits;
}

export interface InitInput {
  seed: number;
  players: Array<{ id: string; slot: number }>;
  config: JsonObject;
}

export interface GameResult {
  reason: string;
  completedTicks: number;
  players: Array<{ id: string; rank: number; score: number }>;
}

export type ActionParseResult<Action> =
  | { ok: true; action: Action }
  | { ok: false; message: string };

export interface GameRules<State, Observation, Action, Event> {
  init(input: InitInput): State;
  observe(
    state: DeepReadonly<State>,
    playerId: string,
    context?: { events: DeepReadonly<Event[]> },
  ): Observation | null;
  parseAction(raw: JsonValue): ActionParseResult<Action>;
  defaultAction(state: DeepReadonly<State>, playerId: string): Action;
  step(
    state: DeepReadonly<State>,
    actions: DeepReadonly<Record<string, Action>>,
  ): {
    nextState: State;
    events: Event[];
    result?: GameResult;
  };
}
