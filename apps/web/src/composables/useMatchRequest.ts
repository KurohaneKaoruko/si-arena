import { onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, errorMessage } from "../api/client";
import { parseMatch } from "../api/contracts";
import { authorizedRequest } from "../auth/session";
import { useToast } from "./useToast";
import { gameMatchLocation } from "../games/locations";

/** A retry after a lost response must reuse the same request identity. */
export function useMatchRequest(gameId: () => string) {
  const router = useRouter();
  const toast = useToast();
  const pending = ref(false);
  const error = ref("");
  let key: string | null = null;
  let current: AbortController | undefined;

  async function start() {
    if (pending.value) return;
    key ??= crypto.randomUUID();
    const request = new AbortController();
    current = request;
    pending.value = true;
    error.value = "";
    try {
      const result = await authorizedRequest(
        `/api/games/${encodeURIComponent(gameId())}/matches`,
        parseMatch,
        { method: "POST", headers: { "Idempotency-Key": key }, signal: request.signal },
      );
      key = null;
      if (!request.signal.aborted) {
        await router.push(gameMatchLocation(gameId(), result.id));
        return true;
      }
    } catch (failure) {
      if (request.signal.aborted) return;
      if (
        failure instanceof ApiError &&
        failure.code === "MATCH_ALREADY_PENDING" &&
        failure.matchId
      ) {
        key = null;
        await router.push(gameMatchLocation(gameId(), failure.matchId));
        return true;
      }
      if (failure instanceof ApiError && failure.status < 500) key = null;
      error.value = errorMessage(failure);
      toast.error(error.value);
    } finally {
      if (current === request) pending.value = false;
    }
  }

  onUnmounted(() => current?.abort());
  return { pending, error, start };
}
