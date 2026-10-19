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
  rngState: number;
}

export interface PaperObservation extends PaperState {
  selfId: string;
  selfSlot: 0 | 1;
}

export interface PaperSdk {
  readonly directions: readonly PaperDirection[];
  homePath(observation: PaperObservation): PaperDirection[] | null;
  threatDistance(observation: PaperObservation): number | null;
  safeMoves(observation: PaperObservation): PaperDirection[];
  expansion(observation: PaperObservation): PaperDirection[];
}
export { PAPER_SDK_SOURCE } from "./source";
