import { onUnmounted, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import { ApiError, apiRequest, errorMessage } from "../api/client";
import { authorizedRequest, session } from "../auth/session";

interface ApiResource<T> {
  data: ShallowRef<T | null>;
  pending: Ref<boolean>;
  error: Ref<string>;
  reload: () => Promise<void>;
}

export function useApiResource<T>(
  path: () => string | null,
  parse: (raw: unknown) => T,
  options: { authenticated?: boolean; pollWhen?: (value: T) => boolean } = {},
): ApiResource<T> {
  const data = shallowRef<T | null>(null);
  const pending = ref(false);
  const error = ref("");
  let current: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let disposed = false;
  function stop() {
    clearTimeout(timer);
    current?.abort();
    pending.value = false;
  }
  function schedule(delay: number) {
    timer = setTimeout(() => void reload(), delay);
  }

  async function reload() {
    stop();
    const url = path();
    if (
      disposed ||
      !url ||
      (options.authenticated && (!session.ready || !session.user)) ||
      (options.pollWhen && document.hidden)
    )
      return;
    const request = new AbortController();
    current = request;
    pending.value = true;
    error.value = "";
    try {
      const result = await (options.authenticated ? authorizedRequest : apiRequest)(url, parse, {
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        data.value = result;
        failures = 0;
        if (options.pollWhen?.(result)) schedule(1000);
      }
    } catch (failure) {
      if (!request.signal.aborted) {
        error.value = errorMessage(failure);
        if (
          options.pollWhen &&
          (!data.value || options.pollWhen(data.value)) &&
          !(failure instanceof ApiError && failure.status < 500 && failure.status !== 429)
        )
          schedule(Math.min(8000, 1000 * 2 ** ++failures));
      }
    } finally {
      if (current === request) pending.value = false;
    }
  }

  watch(
    () => [
      path(),
      options.authenticated ? session.user?.id : null,
      options.authenticated ? session.ready : true,
    ],
    () => {
      data.value = null;
      error.value = "";
      failures = 0;
      void reload();
    },
    { immediate: true },
  );
  function visibility() {
    if (document.hidden) stop();
    else if (!data.value || options.pollWhen?.(data.value)) void reload();
  }
  if (options.pollWhen) document.addEventListener("visibilitychange", visibility);
  onUnmounted(() => {
    disposed = true;
    stop();
    document.removeEventListener("visibilitychange", visibility);
  });
  return { data, pending, error, reload };
}
