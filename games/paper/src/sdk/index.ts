import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import type { PAPER_CONFIG, PAPER_MAX_TICKS } from "../constants";

export type PaperDirection = "up" | "right" | "down" | "left";
export type PaperAction = { type: "move"; direction: PaperDirection } | { type: "idle" };

export interface PaperPlayer {
  id: string;
  slot: 0 | 1;
  alive: boolean;
  position: { x: number; y: number } | null;
}

export interface PaperState {
  tick: number;
  width: typeof PAPER_CONFIG.width;
  height: typeof PAPER_CONFIG.height;
  maxTicks: typeof PAPER_MAX_TICKS;
  territory: number[];
  trails: number[];
  players: [PaperPlayer, PaperPlayer];
  /** Initial head cell per slot; a reset player returns to it. */
  spawns: [{ x: number; y: number }, { x: number; y: number }];
  rngState: number;
}

export type PaperResetCause =
  | "boundary"
  | "head-collision"
  | "head-swap"
  | "self-trail"
  | "trail-cut";
export type PaperPosition = { x: number; y: number };
export type PaperEvent =
  | { type: "move"; playerId: string; from: PaperPosition; to: PaperPosition }
  | { type: "trail-cut"; playerId: string; attackerId: string; position: PaperPosition }
  | { type: "capture"; playerId: string; cells: number[] }
  | {
      type: "reset";
      playerId: string;
      from: PaperPosition;
      to: PaperPosition;
      causes: PaperResetCause[];
    };
export interface PaperVisiblePlayer {
  id: string;
  slot: 0 | 1;
  position: PaperPosition;
  spawn: PaperPosition;
}
export interface PaperBoard {
  width: typeof PAPER_CONFIG.width;
  height: typeof PAPER_CONFIG.height;
  territory: number[];
  trails: number[];
}
/** Public facts only; independent of the engine's internal state layout. */
export interface PaperObservation {
  tick: number;
  maxTicks: typeof PAPER_MAX_TICKS;
  selfId: string;
  selfSlot: 0 | 1;
  board: PaperBoard;
  players: [PaperVisiblePlayer, PaperVisiblePlayer];
  events: PaperEvent[];
}
export interface PaperSelf extends DeepReadonly<PaperVisiblePlayer> {
  /** Register an intent; the position stays unchanged until simultaneous settlement. */
  move(direction: PaperDirection): void;
  idle(): void;
}
export interface PaperGameView {
  readonly tick: number;
  readonly maxTicks: typeof PAPER_MAX_TICKS;
  readonly self: PaperSelf;
  readonly opponent: DeepReadonly<PaperVisiblePlayer>;
  readonly board: DeepReadonly<PaperBoard>;
  /** Public events from the preceding tick, empty at tick 0. */
  readonly events: DeepReadonly<PaperEvent[]>;
}
export interface PaperTickInput {
  readonly game: PaperGameView;
  /** JSON recovery checkpoint. Globals and SDK caches are lost when a tick fails. */
  readonly Memory: JsonObject;
}
export { PAPER_SDK_SOURCE } from "./source";
