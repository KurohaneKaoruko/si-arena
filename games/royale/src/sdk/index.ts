import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import type { ROYALE_MAX_TICKS } from "../constants";

export type RoyaleDirection = "up" | "right" | "down" | "left";
export type RoyaleAction = { type: "move"; direction: RoyaleDirection } | { type: "idle" };
export type RoyalePosition = { x: number; y: number };

/** Death causes in their fixed reporting order. */
export type RoyaleDeathCause =
  | "boundary"
  | "head-collision"
  | "head-swap"
  | "self-trail"
  | "trail-cut"
  | "enclosed"
  | "zone";

export interface RoyaleDeath {
  /** Completed tick count when the player died. */
  tick: number;
  causes: RoyaleDeathCause[];
}

export interface RoyalePlayer {
  id: string;
  slot: number;
  /** Head cell at tick 0, the centre of the initial 3×3 territory. */
  spawn: RoyalePosition;
  /** Current head; null once eliminated. */
  position: RoyalePosition | null;
  /** Null while alive. */
  death: RoyaleDeath | null;
}

export interface RoyaleState {
  tick: number;
  /** Square map; the side depends on the number of players. */
  width: number;
  height: number;
  maxTicks: typeof ROYALE_MAX_TICKS;
  /** Side of the centred safe-zone square. */
  zoneSize: number;
  territory: number[];
  trails: number[];
  players: RoyalePlayer[];
  rngState: number;
}

export type RoyaleEvent =
  | { type: "move"; playerId: string; from: RoyalePosition; to: RoyalePosition }
  | { type: "trail-cut"; playerId: string; attackerId: string; position: RoyalePosition }
  | { type: "capture"; playerId: string; cells: number[] }
  | { type: "zone-shrink"; size: number }
  | { type: "death"; playerId: string; position: RoyalePosition; causes: RoyaleDeathCause[] };

export interface RoyaleBoard {
  width: number;
  height: number;
  territory: number[];
  trails: number[];
}
export interface RoyaleZone {
  /** Current side; cells outside are deadly and always neutral. */
  size: number;
  /** Side the zone shrinks towards for the current number of living players. */
  target: number;
  /** Top-left cell of the zone; the bottom-right cell is min + size - 1 on both axes. */
  min: RoyalePosition;
  /** Ticks until the settlement that removes the next ring, or null while size <= target. */
  ticksToNextShrink: number | null;
}
export interface RoyaleVisiblePlayer {
  id: string;
  slot: number;
  position: RoyalePosition;
  spawn: RoyalePosition;
  /** Territory cells owned. */
  area: number;
}
export interface RoyaleEliminated {
  id: string;
  slot: number;
  /** Completed tick count when the player died. */
  tick: number;
  causes: RoyaleDeathCause[];
}
/** Public facts only; independent of the engine's internal state layout. */
export interface RoyaleObservation {
  tick: number;
  maxTicks: typeof ROYALE_MAX_TICKS;
  selfId: string;
  selfSlot: number;
  board: RoyaleBoard;
  zone: RoyaleZone;
  /** Living players, including self, by slot. */
  players: RoyaleVisiblePlayer[];
  /** Eliminated players by slot. */
  eliminated: RoyaleEliminated[];
  events: RoyaleEvent[];
}
export interface RoyaleSelf extends DeepReadonly<RoyaleVisiblePlayer> {
  /** Register an intent; the position stays unchanged until simultaneous settlement. */
  move(direction: RoyaleDirection): void;
  idle(): void;
}
export interface RoyaleGameView {
  readonly tick: number;
  readonly maxTicks: typeof ROYALE_MAX_TICKS;
  readonly self: RoyaleSelf;
  /** Living opponents by slot. */
  readonly opponents: DeepReadonly<RoyaleVisiblePlayer[]>;
  readonly eliminated: DeepReadonly<RoyaleEliminated[]>;
  readonly board: DeepReadonly<RoyaleBoard>;
  readonly zone: DeepReadonly<RoyaleZone>;
  /** Public events from the preceding tick, empty at tick 0. */
  readonly events: DeepReadonly<RoyaleEvent[]>;
}
export interface RoyaleTickInput {
  readonly game: RoyaleGameView;
  /** JSON recovery checkpoint. Globals and SDK caches are lost when a tick fails. */
  readonly Memory: JsonObject;
}
export { ROYALE_SDK_SOURCE } from "./source";
