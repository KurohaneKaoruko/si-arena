import { defineReplayGame } from "@si-arena/player/browser";
import { paperGame } from "@si-arena/game-paper/game";
import { drawPaperBoard, paperPlayerSummaries } from "@si-arena/game-paper/renderer";

// Explicit trusted releases; file contents only select an entry, never import code.
export const replayGames = [
  defineReplayGame({
    game: paperGame,
    aspectRatio: 4 / 3,
    scoreUnit: "格",
    draw: (context, frame, width, height, motion) =>
      drawPaperBoard(context, frame.state, width, height, {
        previousState: frame.previousState,
        events: frame.events,
        progress: motion.progress,
        reducedMotion: motion.reducedMotion,
        erroredPlayers: new Set(Object.keys(frame.record?.errors ?? {})),
      }),
    summarize: paperPlayerSummaries,
  }),
];
