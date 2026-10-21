import {
  loadRegisteredReplay,
  readBrowserReplay,
  type BrowserReplaySession,
} from "@si-arena/player/browser";
import type { MatchDetail } from "@si-arena/protocol";
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { errorMessage } from "../api/client";
import { downloadReplay } from "../api/replay";
import { canReplay, replayGames } from "../games/replays";

/** Downloads, verifies and loads the replay of a completed match once its status settles. */
export function useMatchReplay(match: () => MatchDetail | null | undefined) {
  const session = shallowRef<BrowserReplaySession | null>(null);
  const error = ref("");
  const pending = ref(false);
  const ticks = ref(0);
  /** Releases without a registered renderer are never downloaded. */
  const unsupported = computed(() => {
    const value = match();
    return !!value && !canReplay(value.gameId, value.release);
  });
  const path = computed(() => {
    const value = match();
    return value ? `/api/matches/${encodeURIComponent(value.id)}/replay` : null;
  });
  let current: AbortController | undefined;

  function cancel() {
    current?.abort();
    pending.value = false;
  }
  async function load() {
    cancel();
    const value = match();
    if (!value || value.status !== "completed" || unsupported.value || !path.value) return;
    const request = new AbortController();
    current = request;
    session.value = null;
    error.value = "";
    pending.value = true;
    ticks.value = 0;
    try {
      const file = await downloadReplay(path.value, request.signal);
      const raw = await readBrowserReplay(file, request.signal);
      const loaded = await loadRegisteredReplay(raw, replayGames, {
        signal: request.signal,
        onProgress: (completed) => {
          if (!request.signal.aborted) ticks.value = completed;
        },
        yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
      });
      if (
        loaded.replay.matchId !== value.id ||
        loaded.replay.game.id !== value.gameId ||
        loaded.replay.game.release !== value.release
      )
        throw new Error("回放与当前比赛不匹配");
      if (!request.signal.aborted) session.value = loaded;
    } catch (failure) {
      if (!request.signal.aborted) error.value = errorMessage(failure);
    } finally {
      if (current === request) pending.value = false;
    }
  }
  watch(
    () => `${match()?.id}:${match()?.status}`,
    () => {
      cancel();
      session.value = null;
      error.value = "";
      if (match()?.status === "completed") void load();
    },
    { immediate: true },
  );
  onUnmounted(cancel);
  return { session, error, pending, ticks, unsupported, path, load, cancel };
}
