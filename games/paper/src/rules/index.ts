import type { GameRules } from "@si-arena/protocol";
import type { PaperAction, PaperObservation, PaperState } from "../sdk/index";

export type PaperEvent =
  | { type: "move"; playerId: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "capture"; playerId: string; cells: number[] }
  | { type: "elimination"; playerId: string };

export type PaperRules = GameRules<PaperState, PaperObservation, PaperAction, PaperEvent>;
