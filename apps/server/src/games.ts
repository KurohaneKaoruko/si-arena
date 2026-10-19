import { paperCatalogEntry } from "@si-arena/game-paper";
import { officialBotUrl } from "@si-arena/game-paper/game";
import type { GameCatalogEntry } from "@si-arena/protocol";

export interface RegisteredGame {
  entry: GameCatalogEntry;
  officialBotUrl: URL;
}

export const registeredGames: readonly RegisteredGame[] = [
  { entry: paperCatalogEntry, officialBotUrl },
];

export const gameCatalog: ReadonlyMap<string, GameCatalogEntry> = new Map(
  registeredGames.map((game) => [game.entry.id, game.entry]),
);
