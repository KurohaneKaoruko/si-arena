import { paperCatalogEntry } from "@si-arena/game-paper";
import { developmentFiles, officialBotUrl } from "@si-arena/game-paper/game";
import { royaleCatalogEntry } from "@si-arena/game-royale";
import {
  developmentFiles as royaleDevelopmentFiles,
  officialBotUrl as royaleOfficialBotUrl,
} from "@si-arena/game-royale/game";
import type { GameCatalogEntry } from "@si-arena/protocol";

export interface RegisteredGame {
  entry: GameCatalogEntry;
  officialBotUrl: URL;
  developmentFiles: { prompt: URL; sdk: URL; template: URL };
}

export const registeredGames: readonly RegisteredGame[] = [
  { entry: paperCatalogEntry, officialBotUrl, developmentFiles },
  {
    entry: royaleCatalogEntry,
    officialBotUrl: royaleOfficialBotUrl,
    developmentFiles: royaleDevelopmentFiles,
  },
];

export const gameCatalog: ReadonlyMap<string, GameCatalogEntry> = new Map(
  registeredGames.map((game) => [game.entry.id, game.entry]),
);
