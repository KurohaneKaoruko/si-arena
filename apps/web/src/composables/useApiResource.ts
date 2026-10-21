import {
  computed,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from "vue";
import { ApiError, apiRequest, errorMessage } from "../api/client";
import { authorizedRequest, session } from "../auth/session";
import { useToast } from "./useToast";

export type ResourceStatus = "loading" | "ready" | "error";

export interface ApiResource<T> {
  data: ShallowRef<T | null>;
  pending: Ref<boolean>;
  /** 首次加载失败：此时没有可展示的数据。 */
  error: Ref<string>;
  /** 已有数据时的刷新失败：内容仍然可用，页面可以保留内容并提示重试。 */
  refreshError: Ref<string>;
  /** 统一三态：加载中、就绪、失败。 */
  status: ComputedRef<ResourceStatus>;
  /** 成功结果是否为空，用于统一空状态。 */
  empty: ComputedRef<boolean>;
  reload: () => Promise<void>;
  cancel: () => void;
}

/**
 * 统一的异步数据入口：负责请求、轮询、取消与三态，
 * 页面只关心 status / empty / error，不用重复写加载与重试逻辑。
 */
export function useApiResource<T>(
  path: () => string | null,
  parse: (raw: unknown) => T,
  options: {
    authenticated?: boolean;
    pollWhen?: (value: T) => boolean;
    /** 轮询间隔（毫秒），默认 1 秒；失败时按该间隔的 2/4/8 倍退避。 */
    pollInterval?: number | ((value: T) => number);
    isEmpty?: (value: T) => boolean;
    /** 加载失败时是否同时弹出顶部提示，默认开启；轮询场景可关闭。 */
    notify?: boolean;
  } = {},
): ApiResource<T> {
  const toast = useToast();
  const data = shallowRef<T | null>(null);
  const pending = ref(false);
  const error = ref("");
  const refreshError = ref("");
  let current: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let interval = typeof options.pollInterval === "number" ? options.pollInterval : 1000;
  let disposed = false;
  let notified = "";
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
        refreshError.value = "";
        failures = 0;
        notified = "";
        if (options.pollWhen?.(result)) {
          const every = options.pollInterval;
          interval = typeof every === "function" ? every(result) : (every ?? 1000);
          schedule(interval);
        }
      }
    } catch (failure) {
      if (!request.signal.aborted) {
        const message = errorMessage(failure);
        // 已经有数据时把失败记成刷新失败，内容继续保留，页面负责提示重试。
        if (data.value !== null) refreshError.value = message;
        else error.value = message;
        if (options.notify !== false && message !== notified) {
          notified = message;
          toast.error(message);
        }
        if (
          options.pollWhen &&
          (!data.value || options.pollWhen(data.value)) &&
          !(failure instanceof ApiError && failure.status < 500 && failure.status !== 429)
        )
          schedule(Math.min(8, 2 ** ++failures) * interval);
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
      refreshError.value = "";
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
  const status = computed<ResourceStatus>(() => {
    // 失败只在没有数据时出现；有数据时的失败走 refreshError，内容继续保留。
    if (error.value) return "error";
    if (data.value !== null) return "ready";
    return "loading";
  });
  const empty = computed(() => data.value !== null && (options.isEmpty?.(data.value) ?? false));
  return { data, pending, error, refreshError, status, empty, reload, cancel: stop };
}
