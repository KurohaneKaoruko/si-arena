import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AppButton from "../src/components/ui/AppButton.vue";
import StateBlock from "../src/components/ui/StateBlock.vue";
import ToastHost from "../src/components/ui/ToastHost.vue";
import { useToast } from "../src/composables/useToast";

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.useFakeTimers();
  useToast().dismiss();
});
afterEach(() => {
  vi.useRealTimers();
  useToast().dismiss();
});

test("a toast replaces the previous one and disappears on its own", async () => {
  const wrapper = mount(ToastHost);
  const { show } = useToast();
  show("第一条", "info");
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain("第一条");
  show("第二条", "danger");
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain("第二条");
  expect(wrapper.text()).not.toContain("第一条");
  vi.advanceTimersByTime(5200);
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).not.toContain("第二条");
});

test("the toast can be dismissed by hand and reports the tone to assistive technology", async () => {
  const wrapper = mount(ToastHost);
  const { error } = useToast();
  error("上传失败");
  await wrapper.vm.$nextTick();
  expect(wrapper.get('[role="status"]').attributes("aria-live")).toBe("assertive");
  expect(wrapper.text()).toContain("上传失败");
  await wrapper.get('button[aria-label="关闭提示"]').trigger("click");
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).not.toContain("上传失败");
});

test("the state block renders loading, error and empty states with a retry action", async () => {
  const loading = mount(StateBlock, { props: { status: "loading" } });
  expect(loading.find('[role="status"]').exists()).toBe(true);
  expect(loading.findAll(".animate-pulse")).toHaveLength(3);
  expect(loading.text()).not.toContain("重新加载");

  const failed = mount(StateBlock, { props: { status: "error", message: "加载失败" } });
  expect(failed.get('[role="alert"]').text()).toContain("加载失败");
  await failed.get("button").trigger("click");
  expect(failed.emitted("retry")).toHaveLength(1);

  const empty = mount(StateBlock, { props: { status: "empty", message: "还没有比赛" } });
  expect(empty.text()).toContain("还没有比赛");
});

test("a link without download stays a navigation so anchor targets still work", () => {
  const anchor = mount(AppButton, {
    props: { href: "#participate" },
    slots: { default: "上传与参赛" },
  });
  expect(anchor.get("a").attributes("href")).toBe("#participate");
  expect(anchor.get("a").attributes("download")).toBeUndefined();

  const file = mount(AppButton, {
    props: { href: "/api/games/paper/releases/paper%400.1.0/download", download: true },
    slots: { default: "下载开发包 ZIP" },
  });
  expect(file.get("a").attributes("download")).toBe("");

  const named = mount(AppButton, {
    props: { href: "data:text/plain,bot", download: "bot.js" },
    slots: { default: "下载 bot.js" },
  });
  expect(named.get("a").attributes("download")).toBe("bot.js");
});
