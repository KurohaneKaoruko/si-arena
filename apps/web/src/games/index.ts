import { paperPresentation } from "@si-arena/game-paper/renderer";
import { royalePresentation } from "@si-arena/game-royale/renderer";
import { snakePresentation } from "@si-arena/game-snake/renderer";
import { bomberPresentation } from "@si-arena/game-bomber/renderer";
import type { GamePresentation } from "@si-arena/player";

export const gamePresentations: ReadonlyMap<string, GamePresentation> = new Map([
  [paperPresentation.id, paperPresentation],
  [royalePresentation.id, royalePresentation],
  [snakePresentation.id, snakePresentation],
  [bomberPresentation.id, bomberPresentation],
]);
