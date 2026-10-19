import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { useApiResource } from "../src/composables/useApiResource";
import { clearSession, session, signIn } from "../src/auth/session";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
