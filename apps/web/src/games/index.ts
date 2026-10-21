import { paperPresentation } from "@si-arena/game-paper/renderer";
import { royalePresentation } from "@si-arena/game-royale/renderer";
import type { GamePresentation } from "@si-arena/player";

export const gamePresentations: ReadonlyMap<string, GamePresentation> = new Map([
  [paperPresentation.id, paperPresentation],
  [royalePresentation.id, royalePresentation],
]);
