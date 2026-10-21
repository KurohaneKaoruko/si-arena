import type { GameCatalogEntry } from "@si-arena/protocol";
import { inject, provide, type InjectionKey } from "vue";
import { parseGames } from "../api/contracts";
import { useApiResource, type ApiResource } from "../composables/useApiResource";

type Catalog = ApiResource<{ games: GameCatalogEntry[] }>;
const key: InjectionKey<Catalog> = Symbol("catalog");
const load = () => useApiResource(() => "/api/games", parseGames, { notify: false });

/** The app shell loads the catalog once; pages read the same resource. */
export function provideCatalog(): Catalog {
  const catalog = load();
  provide(key, catalog);
  return catalog;
}

/** Falls back to a page-local load when mounted outside the app shell. */
export function useCatalog(): Catalog {
  return inject(key, load, true);
}

/** The head-to-head game behind the「圈地 1v1」entry: the first game without an arena. */
export const duelGame = (games: readonly GameCatalogEntry[] | undefined) =>
  games?.find((game) => !game.arena);

/** The game behind「大逃杀」: the first game whose manifest declares an arena. */
export const arenaGame = (games: readonly GameCatalogEntry[] | undefined) =>
  games?.find((game) => game.arena);
