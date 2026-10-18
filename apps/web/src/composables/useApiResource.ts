import { onUnmounted, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";

interface ApiResource<T> {
  data: ShallowRef<T | null>;
  pending: Ref<boolean>;
  error: Ref<string>;
  reload: () => Promise<void>;
}

export function useApiResource<T>(path: () => string): ApiResource<T> {
  const data = shallowRef<T | null>(null);
  const pending = ref(false);
  const error = ref("");
  let current: AbortController | undefined;

  async function reload() {
    current?.abort();
    const request = new AbortController();
    current = request;
    pending.value = true;
    error.value = "";
    data.value = null;
    try {
      const response = await fetch(path(), { signal: request.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as T;
      if (!request.signal.aborted) data.value = result;
    } catch {
      if (!request.signal.aborted) error.value = "暂时无法加载游戏，请稍后重试。";
    } finally {
      if (current === request) pending.value = false;
    }
  }

  watch(
    path,
    () => {
      void reload();
    },
    { immediate: true },
  );
  onUnmounted(() => current?.abort());
  return { data, pending, error, reload };
}
