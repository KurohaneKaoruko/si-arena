import type { DeepReadonly, GameCatalogEntry } from "@si-arena/protocol";

export interface PlaybackState {
  tick: number;
  totalTicks: number;
  playing: boolean;
  speed: number;
}

export interface GameRendererProps<State, Event> {
  state: DeepReadonly<State>;
  previousState: DeepReadonly<State>;
  events: DeepReadonly<Event[]>;
  progress: number;
}

export const PLAYBACK_SPEEDS = Object.freeze([0.5, 1, 2, 4, 8] as const);

export interface GamePresentation {
  id: string;
  headline: string;
  instructions: readonly string[];
  getStats(game: GameCatalogEntry): ReadonlyArray<{ label: string; value: string }>;
}
