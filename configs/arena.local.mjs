import { defineLocalGame } from "@si-arena/cli";
import { paperGame, PAPER_SDK_SOURCE, officialBotUrl } from "@si-arena/game-paper/game";
import * as royale from "@si-arena/game-royale/game";

// Trusted repository registration. Player sources are read as text and only run in QuickJS.
export default [
  defineLocalGame({
    game: paperGame,
    sdkSource: PAPER_SDK_SOURCE,
    officialBotUrl,
  }),
  defineLocalGame({
    game: royale.royaleGame,
    sdkSource: royale.ROYALE_SDK_SOURCE,
    officialBotUrl: royale.officialBotUrl,
  }),
];
