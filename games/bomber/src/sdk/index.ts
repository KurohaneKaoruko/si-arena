import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import type { BOMBER_CONFIG, BOMBER_MAX_TICKS } from "../constants";

export type BomberDirection = "up" | "right" | "down" | "left";
export type BomberAction =
  | { type: "move"; direction: BomberDirection }
  | { type: "bomb" }
  | { type: "idle" };
export type BomberPosition = { x: number; y: number };
export type BomberPowerupKind = "fire" | "bomb";

/** Death causes in their fixed reporting order. */
export type BomberDeathCause = "flame" | "collapse";

export interface BomberDeath {
  /** Completed tick count when the player died. */
  tick: number;
  causes: BomberDeathCause[];
}

export interface BomberBomb {
  position: BomberPosition;
  /** Slot of the player who placed it; the bomb outlives its owner. */
  owner: number;
  /** Settlements left before it explodes, counted after this tick's decrement (1–7). */
  fuse: number;
  range: number;
}

export interface BomberPowerup {
  position: BomberPosition;
  kind: BomberPowerupKind;
}

export interface BomberPlayer {
  id: string;
  slot: number;
  /** Current cell; null once eliminated. */
  position: BomberPosition | null;
  bombsMax: number;
  fireRange: number;
  /** Walls destroyed and kills; 0 once eliminated. */
  score: number;
  /** Null while alive. */
  death: BomberDeath | null;
}

export interface BomberState {
  tick: number;
  width: typeof BOMBER_CONFIG.width;
  height: typeof BOMBER_CONFIG.height;
  maxTicks: typeof BOMBER_MAX_TICKS;
  /** 0 empty, 1 pillar, 2 soft wall, 3 collapsed; index `y * width + x`. */
  cells: number[];
  /** Item under each soft wall: 0 none, 1 fire, 2 bomb; 0 everywhere else. */
  hidden: number[];
  /** In placement order. */
  bombs: BomberBomb[];
  powerups: BomberPowerup[];
  players: BomberPlayer[];
  rngState: number;
}

export type BomberEvent =
  | { type: "move"; playerId: string; from: BomberPosition; to: BomberPosition }
  | { type: "bomb-placed"; playerId: string; position: BomberPosition }
  | {
      type: "explosion";
      bombs: Array<{ position: BomberPosition; ownerId: string }>;
      /** Flame cells, ascending. */
      cells: number[];
      /** Soft walls destroyed, ascending. */
      destroyed: number[];
    }
  | { type: "pickup"; playerId: string; kind: BomberPowerupKind; position: BomberPosition }
  | { type: "collapse"; ring: number; cells: number[] }
  | {
      type: "death";
      playerId: string;
      position: BomberPosition;
      causes: BomberDeathCause[];
      /** Owners of bombs whose flames covered the cell, without the victim, by slot. */
      killerIds: string[];
    };

export interface BomberBoard {
  width: typeof BOMBER_CONFIG.width;
  height: typeof BOMBER_CONFIG.height;
  cells: number[];
}
export interface BomberCollapse {
  startTick: typeof BOMBER_CONFIG.collapseStart;
  interval: typeof BOMBER_CONFIG.collapseInterval;
  /** Ring 0–5 that collapses next, or null once ring 5 is gone. */
  nextRing: number | null;
  /** Ticks until the settlement that collapses it (1 = the next one), or null. */
  ticksToNextCollapse: number | null;
}
export interface BomberVisiblePlayer {
  id: string;
  slot: number;
  position: BomberPosition;
  bombsMax: number;
  fireRange: number;
  /** Own bombs currently on the map. */
  activeBombs: number;
  score: number;
}
export interface BomberEliminated {
  id: string;
  slot: number;
  /** Completed tick count when the player died. */
  tick: number;
  causes: BomberDeathCause[];
}
/** Public facts only; independent of the engine's internal state layout. */
export interface BomberObservation {
  tick: number;
  maxTicks: typeof BOMBER_MAX_TICKS;
  selfId: string;
  selfSlot: number;
  board: BomberBoard;
  bombs: BomberBomb[];
  powerups: BomberPowerup[];
  collapse: BomberCollapse;
  /** Living players, including self, by slot. */
  players: BomberVisiblePlayer[];
  /** Eliminated players by slot. */
  eliminated: BomberEliminated[];
  events: BomberEvent[];
}
export interface BomberSelf extends DeepReadonly<BomberVisiblePlayer> {
  /** Register an intent; the world stays unchanged until simultaneous settlement. */
  move(direction: BomberDirection): void;
  bomb(): void;
  idle(): void;
}
export interface BomberGameView {
  readonly tick: number;
  readonly maxTicks: typeof BOMBER_MAX_TICKS;
  readonly self: BomberSelf;
  /** Living opponents by slot. */
  readonly opponents: DeepReadonly<BomberVisiblePlayer[]>;
  readonly eliminated: DeepReadonly<BomberEliminated[]>;
  readonly board: DeepReadonly<BomberBoard>;
  readonly bombs: DeepReadonly<BomberBomb[]>;
  readonly powerups: DeepReadonly<BomberPowerup[]>;
  readonly collapse: DeepReadonly<BomberCollapse>;
  /** Public events from the preceding tick, empty at tick 0. */
  readonly events: DeepReadonly<BomberEvent[]>;
}
export interface BomberTickInput {
  readonly game: BomberGameView;
  /** JSON recovery checkpoint. Globals and SDK caches are lost when a tick fails. */
  readonly Memory: JsonObject;
}
export { BOMBER_SDK_SOURCE } from "./source";
