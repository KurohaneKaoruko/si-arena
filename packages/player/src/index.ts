import type { GameCatalogEntry } from "@si-arena/protocol";

export interface PlaybackState {
  tick: number;
  totalTicks: number;
  playing: boolean;
  speed: number;
}

export {
  PLAYBACK_SPEEDS,
  usePlayback,
  type AnimationClock,
  type PlaybackOptions,
  type PlaybackSource,
} from "./playback";
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
