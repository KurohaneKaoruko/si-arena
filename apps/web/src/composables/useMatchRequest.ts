import { onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, errorMessage } from "../api/client";
import { parseMatch } from "../api/contracts";
import { authorizedRequest } from "../auth/session";
import { useToast } from "./useToast";
import { gameMatchLocation } from "../games/locations";

/** crypto.randomUUID 只在安全上下文暴露；纯 HTTP（裸 IP、非标端口）部署下
 * 浏览器没有该函数，退回用非安全上下文也可用的 getRandomValues 拼 v4。 */
function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A retry after a lost response must reuse the same request identity. */
export function useMatchRequest(gameId: () => string) {
  const router = useRouter();
  const toast = useToast();
  const pending = ref(false);
  const error = ref("");
  let key: string | null = null;
  let current: AbortController | undefined;

  async function start(): Promise<boolean> {
    if (pending.value) return false;
    key ??= randomUuid();
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
      if (request.signal.aborted) return false;
      await router.push(gameMatchLocation(gameId(), result.id));
      return true;
    } catch (failure) {
      if (request.signal.aborted) return false;
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
      return false;
    } finally {
      if (current === request) pending.value = false;
    }
  }

  onUnmounted(() => current?.abort());
  return { pending, error, start };
}
