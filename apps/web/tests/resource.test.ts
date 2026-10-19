import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { useApiResource } from "../src/composables/useApiResource";
import { useToast } from "../src/composables/useToast";
import { clearSession, session, signIn } from "../src/auth/session";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useToast().dismiss();
  clearSession();
});

test("logout clears private data and an aborted response cannot repopulate it", async () => {
  const user = { id: "private-user", username: "private", official: false };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ user, token: "a".repeat(43) }))
    .mockResolvedValueOnce(json("private code"));
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "private", "secret");
  let resource!: ReturnType<typeof useApiResource<string>>;
  const wrapper = mount(
    defineComponent({
      setup() {
        resource = useApiResource(
          () => "/private",
          (value) => String(value),
          { authenticated: true },
        );
        return () => h("p", resource.data.value ?? "");
      },
    }),
  );
  await flushPromises();
  expect(wrapper.text()).toBe("private code");
  let finish!: (response: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const reload = resource.reload();
  clearSession();
  await flushPromises();
  expect(wrapper.text()).toBe("");
  finish(json("late private code"));
  await reload;
  await flushPromises();
  expect(wrapper.text()).toBe("");
  wrapper.unmount();
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("the resource reports its states and keeps stale data when a refresh fails", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(json("value"))
    .mockResolvedValueOnce(json(""))
    .mockRejectedValueOnce(new TypeError("offline"));
  vi.stubGlobal("fetch", fetch);
  let resource!: ReturnType<typeof useApiResource<string>>;
  const wrapper = mount(
    defineComponent({
      setup() {
        resource = useApiResource(
          () => "/thing",
          (value) => String(value),
          {
            isEmpty: (value) => value === "",
          },
        );
        return () => h("p", resource.status.value);
      },
    }),
  );
  await flushPromises();
  // 首次加载失败：没有数据可展示，报错
  expect(resource.status.value).toBe("error");
  expect(resource.error.value).not.toBe("");
  expect(resource.data.value).toBeNull();
  expect(resource.empty.value).toBe(false);

  await resource.reload();
  await flushPromises();
  expect(resource.status.value).toBe("ready");
  expect(resource.data.value).toBe("value");
  expect(resource.error.value).toBe("");
  expect(resource.empty.value).toBe(false);

  await resource.reload();
  await flushPromises();
  expect(resource.empty.value).toBe(true);

  // 刷新失败：旧数据继续保留，状态仍是就绪，失败单独记下来
  await resource.reload();
  await flushPromises();
  expect(resource.status.value).toBe("ready");
  expect(resource.data.value).toBe("");
  expect(resource.refreshError.value).not.toBe("");
  expect(resource.error.value).toBe("");
  wrapper.unmount();
});

test("the same failure is reported to the user only once", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("offline"));
  vi.stubGlobal("fetch", fetch);
  const toast = useToast();
  let resource!: ReturnType<typeof useApiResource<string>>;
  const wrapper = mount(
    defineComponent({
      setup() {
        resource = useApiResource(
          () => "/thing",
          (value) => String(value),
        );
        return () => h("p", resource.status.value);
      },
    }),
  );
  await flushPromises();
  expect(toast.current.value?.message).toBe("网络连接失败，请检查连接后重试。");
  const reported = toast.current.value?.id;
  expect(reported).toBeTypeOf("number");

  await resource.reload();
  await flushPromises();
  expect(toast.current.value?.id).toBe(reported);
  wrapper.unmount();
});

test("polls active matches, backs off on failures, pauses hidden tabs and stops at completion", async () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json("pending"))
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(json("running"))
    .mockResolvedValueOnce(json("completed"));
  vi.stubGlobal("fetch", fetch);
  const wrapper = mount(
    defineComponent({
      setup() {
        const resource = useApiResource(
          () => "/match",
          (value) => String(value),
          { pollWhen: (value) => value !== "completed" },
        );
        return () => h("p", resource.data.value ?? "");
      },
    }),
  );
  await flushPromises();
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  await flushPromises();
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await flushPromises();
  expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(3999);
  expect(fetch).toHaveBeenCalledTimes(3);
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(3);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await flushPromises();
  expect(wrapper.text()).toBe("running");
  await vi.advanceTimersByTimeAsync(1000);
  await flushPromises();
  expect(wrapper.text()).toBe("completed");
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(5);
  wrapper.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("route changes abort old requests and ignore late responses", async () => {
  clearSession();
  session.user = { id: "one", username: "one", official: false };
  const path = ref("/first");
  let resolveOld!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce(json("second"));
  vi.stubGlobal("fetch", fetch);
  const wrapper = mount(
    defineComponent({
      setup() {
        const resource = useApiResource(
          () => path.value,
          (value) => String(value),
        );
        return () => h("p", resource.data.value ?? "");
      },
    }),
  );
  await nextTick();
  const signal = fetch.mock.calls[0]?.[1].signal as AbortSignal;
  path.value = "/second";
  await flushPromises();
  expect(signal.aborted).toBe(true);
  expect(wrapper.text()).toBe("second");
  resolveOld(json("stale"));
  await flushPromises();
  expect(wrapper.text()).toBe("second");
  wrapper.unmount();
});
