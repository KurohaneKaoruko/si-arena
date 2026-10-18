import type { DeepReadonly, JsonObject, JsonValue } from "./json.js";
import type { ResourceLimitOverrides, ResourceLimits } from "./resources.js";

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
  observe(state: DeepReadonly<State>, playerId: string): Observation | null;
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
