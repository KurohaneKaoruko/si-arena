import type { CreateMatchRequest, MatchDetail } from "@si-arena/protocol";
import { onUnmounted, ref, shallowRef } from "vue";
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

/**
 * A retry after a lost response must reuse the same request identity; a different
 * request (another path or body) gets a new one. Rejected requests (4xx) are final.
 */
export function useIdempotentPost() {
  const pending = ref(false);
  let key: string | null = null;
  let keyFor = "";
  let current: AbortController | undefined;

  /** Resolves undefined when the request was superseded or the component left. */
  async function post(path: string, body: object): Promise<MatchDetail | undefined> {
    if (pending.value) return undefined;
    const identity = `${path} ${JSON.stringify(body)}`;
    if (key === null || identity !== keyFor) {
      key = randomUuid();
      keyFor = identity;
    }
    const request = new AbortController();
    current = request;
    pending.value = true;
    try {
      const result = await authorizedRequest(path, parseMatch, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        signal: request.signal,
      });
      key = null;
      return request.signal.aborted ? undefined : result;
    } catch (failure) {
      if (request.signal.aborted) return undefined;
      if (failure instanceof ApiError && failure.status < 500) key = null;
      throw failure;
    } finally {
      if (current === request) pending.value = false;
    }
  }

  onUnmounted(() => current?.abort());
  return { pending, post };
}

/** Ranked matchmaking, a practice challenge or a boss challenge; all open the created match. */
export function useMatchRequest(gameId: () => string) {
  const router = useRouter();
  const toast = useToast();
  const { pending, post } = useIdempotentPost();
  const error = ref("");
  /** The request in flight or last sent, so callers can tell which button is busy. */
  const body = shallowRef<CreateMatchRequest | null>(null);

  async function start(request: CreateMatchRequest = {}): Promise<boolean> {
    if (pending.value) return false;
    body.value = request;
    error.value = "";
    try {
      const match = await post(`/api/games/${encodeURIComponent(gameId())}/matches`, request);
      if (!match) return false;
      await router.push(gameMatchLocation(gameId(), match.id));
      return true;
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        failure.code === "MATCH_ALREADY_PENDING" &&
        failure.matchId
      ) {
        await router.push(gameMatchLocation(gameId(), failure.matchId));
        return true;
      }
      error.value = errorMessage(failure);
      toast.error(error.value);
      return false;
    }
  }

  return { pending, error, body, start };
}
