import { defineLocalGame } from "@si-arena/cli";
import { paperGame, PAPER_SDK_SOURCE, officialBotUrl } from "@si-arena/game-paper/game";

// Trusted repository registration. Player sources are read as text and only run in QuickJS.
export default [defineLocalGame({ game: paperGame, sdkSource: PAPER_SDK_SOURCE, officialBotUrl })];
