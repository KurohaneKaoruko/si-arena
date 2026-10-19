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

export { PLAYBACK_SPEEDS, usePlayback, type AnimationClock, type PlaybackSource } from "./playback";
export {
  createReplaySession,
  REPLAY_MAX_BYTES,
  type ReplayFrame,
  type SessionOptions,
} from "./session";

export interface GamePresentation {
  id: string;
  headline: string;
  instructions: readonly string[];
  getStats(game: GameCatalogEntry): ReadonlyArray<{ label: string; value: string }>;
}
