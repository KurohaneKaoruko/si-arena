import type { GameCatalogEntry } from "@si-arena/protocol";
import { ref } from "vue";
import { ApiError, errorMessage } from "../api/client";
import { parseArenaStatus } from "../api/contracts";
import { useApiResource } from "./useApiResource";
import { useIdempotentPost } from "./useMatchRequest";

/** The single shared arena of a game: live status plus the idempotent start request. */
export function useArena(game: () => GameCatalogEntry | null | undefined) {
  const path = () => {
    const current = game();
    return current?.arena ? `/api/games/${encodeURIComponent(current.id)}/arena` : null;
  };
  const status = useApiResource(path, parseArenaStatus, {
    pollWhen: () => true,
    pollInterval: (value) => (value.active ? 3000 : 15000),
    notify: false,
  });
  const { pending: starting, post } = useIdempotentPost();
  const error = ref("");

  async function start(): Promise<boolean> {
    const url = path();
    if (!url || starting.value) return false;
    error.value = "";
    try {
      const run = await post(url, {});
      if (!run) return false;
      await status.reload();
      return true;
    } catch (failure) {
      // Someone else started a run first: show it as running instead of failing.
      if (!(failure instanceof ApiError && failure.code === "ARENA_BUSY"))
        error.value = errorMessage(failure);
      await status.reload();
      return false;
    }
  }

  return { status, starting, error, start };
}
