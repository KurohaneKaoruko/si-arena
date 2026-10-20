import type { GameCatalogEntry } from "@si-arena/protocol";
import { paperGame } from "@si-arena/game-paper/game";
import { drawPaperBoard } from "@si-arena/game-paper/renderer";

export interface GamePreviewScene {
  aspectRatio: number;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
}

// Trusted initial worlds only. No player source, sandbox, matches, or ticks are executed.
export const gamePreviews: ReadonlyMap<string, (game: GameCatalogEntry) => GamePreviewScene> =
  new Map([
    [
      paperGame.manifest.id,
      (game) => {
        if (game.release !== paperGame.manifest.release)
          throw new Error("未注册此游戏发行的初始画面。");
        const config = paperGame.parseConfig(game.config);
        const state = paperGame.rules.init({
          seed: 42,
          config,
          players: [
            { id: "preview-1", slot: 0 },
            { id: "preview-2", slot: 1 },
          ],
        });
        return {
          aspectRatio: state.width / state.height,
          draw: (context, width, height) =>
            drawPaperBoard(context, state, width, height, {
              previousState: state,
              events: [],
              progress: 1,
              reducedMotion: true,
              erroredPlayers: new Set(),
            }),
        };
      },
    ],
  ]);
