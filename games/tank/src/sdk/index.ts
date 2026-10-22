import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import type { TANK_MAX_TICKS } from "../constants";

export type TankDirection = "up" | "right" | "down" | "left";
export type TankAction =
  | { type: "move"; direction: TankDirection }
  | { type: "fire" }
  | { type: "idle" };
export type TankPosition = { x: number; y: number };
/** 0 empty, 1 brick (destructible), 2 steel (indestructible). */
export type TankCell = 0 | 1 | 2;

export interface TankUnit {
  id: string;
  slot: number;
  /** Null once destroyed. */
  position: TankPosition | null;
  facing: TankDirection;
  /** 0 once destroyed. */
  hp: number;
  /** Completed tick count when the tank was destroyed; null while alive. */
  death: { tick: number } | null;
}
export interface TankBullet {
  position: TankPosition;
  direction: TankDirection;
  /** Slot of the tank that fired it; the bullet never hits that tank. */
  owner: number;
}

export interface TankState {
  tick: number;
  width: number;
  height: number;
  maxTicks: typeof TANK_MAX_TICKS;
  /** Terrain by `y * width + x`. */
  cells: number[];
  /** By slot. */
  tanks: TankUnit[];
  /** In fire order. */
  bullets: TankBullet[];
  /** Only initialization draws random numbers; step never changes it. */
  rngState: number;
}

export type TankEvent =
  | {
      type: "move";
      playerId: string;
      from: TankPosition;
      to: TankPosition;
      facing: TankDirection;
    }
  | { type: "fire"; playerId: string; position: TankPosition; direction: TankDirection }
  | { type: "hit"; playerId: string; attackerId: string; position: TankPosition; hp: number }
  | { type: "brick-destroyed"; attackerId: string; cells: number[] }
  | { type: "bullets-cancelled"; position: TankPosition }
  | { type: "death"; playerId: string; position: TankPosition };

export interface TankBoard {
  width: number;
  height: number;
  cells: number[];
}
export interface TankVisibleTank {
  id: string;
  slot: number;
  position: TankPosition;
  facing: TankDirection;
  hp: number;
  /** True while this tank's bullet is flying, so `fire` would be ignored. */
  bulletInFlight: boolean;
}
export interface TankVisibleBullet {
  position: TankPosition;
  direction: TankDirection;
  ownerSlot: number;
}
export interface TankEliminated {
  id: string;
  slot: number;
  tick: number;
}
/** Public facts only; independent of the engine's internal state layout. */
export interface TankObservation {
  tick: number;
  maxTicks: typeof TANK_MAX_TICKS;
  selfId: string;
  selfSlot: number;
  board: TankBoard;
  /** Living tanks by slot; a death ends the match, so both are always listed. */
  tanks: TankVisibleTank[];
  bullets: TankVisibleBullet[];
  /** Always empty: a destroyed tank ends the match before the next observation. */
  eliminated: TankEliminated[];
  events: TankEvent[];
}
export interface TankSelf extends DeepReadonly<TankVisibleTank> {
  /** Turn the barrel to `direction`, then try to advance one cell. */
  move(direction: TankDirection): void;
  /** Fire along the current facing; ignored while an own bullet is in flight. */
  fire(): void;
  idle(): void;
}
export interface TankGameView {
  readonly tick: number;
  readonly maxTicks: typeof TANK_MAX_TICKS;
  readonly self: TankSelf;
  /** The opponent while alive, otherwise null. */
  readonly opponent: DeepReadonly<TankVisibleTank> | null;
  readonly bullets: DeepReadonly<TankVisibleBullet[]>;
  readonly eliminated: DeepReadonly<TankEliminated[]>;
  readonly board: DeepReadonly<TankBoard>;
  /** Public events from the preceding tick, empty at tick 0. */
  readonly events: DeepReadonly<TankEvent[]>;
}
export interface TankTickInput {
  readonly game: TankGameView;
  /** JSON recovery checkpoint. Globals and SDK caches are lost when a tick fails. */
  readonly Memory: JsonObject;
}
export { TANK_SDK_SOURCE } from "./source";
