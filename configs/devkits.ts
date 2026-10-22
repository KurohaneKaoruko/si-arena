import {
  paperGame,
  developmentFiles,
  officialBotUrl,
  PAPER_SDK_SOURCE,
} from "@si-arena/game-paper/game";
import * as royale from "@si-arena/game-royale/game";
import * as snake from "@si-arena/game-snake/game";

// Trusted build registrations: adding a game does not change the archive builder.
export const devkitGames = [
  {
    game: paperGame,
    packageName: "@si-arena/game-paper",
    directory: "games/paper",
    gameExport: "paperGame",
    sdkSourceExport: "PAPER_SDK_SOURCE",
    sdkInputType: "PaperTickInput",
    developmentFiles,
    officialBotUrl,
    sdkSource: PAPER_SDK_SOURCE,
  },
  {
    game: royale.royaleGame,
    packageName: "@si-arena/game-royale",
    directory: "games/royale",
    gameExport: "royaleGame",
    sdkSourceExport: "ROYALE_SDK_SOURCE",
    sdkInputType: "RoyaleTickInput",
    developmentFiles: royale.developmentFiles,
    officialBotUrl: royale.officialBotUrl,
    sdkSource: royale.ROYALE_SDK_SOURCE,
  },
  {
    game: snake.snakeGame,
    packageName: "@si-arena/game-snake",
    directory: "games/snake",
    gameExport: "snakeGame",
    sdkSourceExport: "SNAKE_SDK_SOURCE",
    sdkInputType: "SnakeTickInput",
    developmentFiles: snake.developmentFiles,
    officialBotUrl: snake.officialBotUrl,
    sdkSource: snake.SNAKE_SDK_SOURCE,
  },
];
