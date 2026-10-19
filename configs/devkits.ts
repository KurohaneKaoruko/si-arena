import {
  paperGame,
  developmentFiles,
  officialBotUrl,
  PAPER_SDK_SOURCE,
} from "@si-arena/game-paper/game";

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
];
