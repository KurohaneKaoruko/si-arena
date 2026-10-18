import { paperCatalogEntry } from "@si-arena/game-paper";
import type { GameCatalogEntry } from "@si-arena/protocol";

export const gameCatalog: ReadonlyMap<string, GameCatalogEntry> = new Map([
  [paperCatalogEntry.id, paperCatalogEntry],
]);
