import { defineLocalGame } from "@si-arena/cli";
import { paperGame, officialBotUrl } from "@si-arena/game-paper/game";
import * as royale from "@si-arena/game-royale/game";

// Trusted repository registration. Player sources are read as text and only run in the isolated V8 sandbox.
export default [
  defineLocalGame({
    game: paperGame,
    module: {
      url: import.meta.resolve("@si-arena/game-paper/game"),
      gameExport: "paperGame",
      sdkSourceExport: "PAPER_SDK_SOURCE",
    },
    officialBotUrl,
  }),
  defineLocalGame({
    game: royale.royaleGame,
    module: {
      url: import.meta.resolve("@si-arena/game-royale/game"),
      gameExport: "royaleGame",
      sdkSourceExport: "ROYALE_SDK_SOURCE",
    },
    officialBotUrl: royale.officialBotUrl,
  }),
];
