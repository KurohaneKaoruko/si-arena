import { enableAutoUnmount, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AppButton from "../src/components/ui/AppButton.vue";
import AppSelect from "../src/components/ui/AppSelect.vue";
import AppSlider from "../src/components/ui/AppSlider.vue";
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

test("the slider reports its value and moves with the keyboard", async () => {
  const wrapper = mount(AppSlider, {
    props: {
      modelValue: 5,
      min: 0,
      max: 10,
      label: "时间轴",
      valueText: "已完成 5 tick",
    },
  });
  const slider = wrapper.get('[role="slider"]');
  expect(slider.attributes("aria-label")).toBe("时间轴");
  expect(slider.attributes("aria-valuemin")).toBe("0");
  expect(slider.attributes("aria-valuemax")).toBe("10");
  expect(slider.attributes("aria-valuenow")).toBe("5");
  expect(slider.attributes("aria-valuetext")).toBe("已完成 5 tick");
  expect(slider.attributes("tabindex")).toBe("0");

  await slider.trigger("keydown", { key: "ArrowRight" });
  expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([6]);
  await slider.trigger("keydown", { key: "ArrowLeft" });
  expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([4]);
  await slider.trigger("keydown", { key: "Home" });
  expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([0]);
  await slider.trigger("keydown", { key: "End" });
  expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([10]);
  // 越界的方向键要夹在区间内
  await slider.trigger("keydown", { key: "PageUp" });
  expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([10]);
});

test("the slider keeps its own keys away from the page around it", async () => {
  const onKeydown = vi.fn();
  const wrapper = mount(
    defineComponent({
      setup() {
        return () =>
          h("div", { onKeydown }, [
            h(AppSlider, { modelValue: 0, min: 0, max: 10, label: "时间轴" }),
          ]);
      },
    }),
  );
  const slider = wrapper.get('[role="slider"]');
  await slider.trigger("keydown", { key: "ArrowRight" });
  await slider.trigger("keydown", { key: "End" });
  expect(onKeydown).not.toHaveBeenCalled();
});

test("the slider ignores the keyboard while it is disabled", async () => {
  const wrapper = mount(AppSlider, {
    props: { modelValue: 5, min: 0, max: 10, label: "时间轴", disabled: true },
  });
  const slider = wrapper.get('[role="slider"]');
  expect(slider.attributes("aria-disabled")).toBe("true");
  await slider.trigger("keydown", { key: "ArrowRight" });
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
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

  // 模板里的裸 download 属性会被解析成空串，这是线上真正用到的形态
  const bare = mount(AppButton, {
    props: { href: "/api/games/paper/releases/paper%400.1.0/download", download: "" },
    slots: { default: "下载开发包 ZIP" },
  });
  expect(bare.get("a").attributes("download")).toBe("");
});

test("a disabled link cannot be focused or followed", () => {
  const wrapper = mount(AppButton, {
    props: { href: "/account", disabled: true },
    slots: { default: "账号" },
  });
  expect(wrapper.find("a").exists()).toBe(false);
  expect(wrapper.get("span").attributes("aria-disabled")).toBe("true");
  expect(wrapper.get("span").attributes("tabindex")).toBe("-1");
});

test("the link variant is not given a button box", () => {
  const wrapper = mount(AppButton, {
    props: { variant: "link" },
    slots: { default: "文字链接" },
  });
  expect(wrapper.get("button").classes()).not.toContain("px-3.5");
  expect(wrapper.get("button").classes()).not.toContain("min-h-9");
});

test("the select opens, reports its combobox state and picks an option", async () => {
  const wrapper = mount(AppSelect, {
    props: {
      modelValue: "a",
      options: [
        { value: "a", label: "第一项" },
        { value: "b", label: "第二项" },
        { value: "c", label: "第三项", disabled: true },
      ],
      label: "选项",
      id: "picker",
    },
  });
  const trigger = wrapper.get("#picker");
  expect(trigger.attributes("role")).toBe("combobox");
  expect(trigger.attributes("aria-expanded")).toBe("false");
  expect(trigger.text()).toContain("第一项");

  await trigger.trigger("click");
  expect(trigger.attributes("aria-expanded")).toBe("true");
  const listbox = wrapper.find('[role="listbox"]');
  expect(listbox.exists()).toBe(true);
  expect(wrapper.findAll('[role="option"]')).toHaveLength(3);
  expect(wrapper.get('[role="option"][data-value="a"]').attributes("aria-selected")).toBe("true");

  await wrapper.get('[role="option"][data-value="b"]').trigger("click");
  expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["b"]);
  expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
});

test("the select moves with the keyboard and never lands on a disabled option", async () => {
  const wrapper = mount(AppSelect, {
    props: {
      modelValue: "a",
      options: [
        { value: "a", label: "第一项" },
        { value: "b", label: "第二项" },
        { value: "c", label: "第三项", disabled: true },
      ],
      label: "选项",
    },
  });
  await wrapper.get("button").trigger("keydown", { key: "ArrowDown" });
  expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
  const active = () => wrapper.get('[role="option"][data-active="true"]').attributes("data-value");

  await wrapper.get('[role="listbox"]').trigger("keydown", { key: "ArrowDown" });
  expect(active()).toBe("b");
  // 再往下必须跳过被禁用的第三项，绕回第一项
  await wrapper.get('[role="listbox"]').trigger("keydown", { key: "ArrowDown" });
  expect(active()).toBe("a");
  // End 落在最后一个可用项上，而不是被禁用的末项
  await wrapper.get('[role="listbox"]').trigger("keydown", { key: "End" });
  expect(active()).toBe("b");

  await wrapper.get('[role="listbox"]').trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["b"]);

  await wrapper.get("button").trigger("keydown", { key: "ArrowDown" });
  await wrapper.get('[role="listbox"]').trigger("keydown", { key: "Escape" });
  expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
});

test("the select tells assistive technology which option is highlighted", async () => {
  const wrapper = mount(AppSelect, {
    props: {
      modelValue: "a",
      options: [
        { value: "a", label: "第一项" },
        { value: "b", label: "第二项" },
      ],
      label: "选项",
    },
  });
  await wrapper.get("button").trigger("click");
  const listbox = wrapper.get('[role="listbox"]');
  expect(listbox.attributes("aria-activedescendant")).toBe(
    wrapper.get('[role="option"][data-value="a"]').attributes("id"),
  );
  await listbox.trigger("keydown", { key: "ArrowDown" });
  expect(wrapper.get('[role="listbox"]').attributes("aria-activedescendant")).toBe(
    wrapper.get('[role="option"][data-value="b"]').attributes("id"),
  );
});

test("the select keeps its own keys away from the page around it", async () => {
  const onKeydown = vi.fn();
  const wrapper = mount(
    defineComponent({
      setup() {
        return () =>
          h("div", { onKeydown }, [
            h(AppSelect, {
              modelValue: "a",
              options: [
                { value: "a", label: "第一项" },
                { value: "b", label: "第二项" },
              ],
              label: "选项",
            }),
          ]);
      },
    }),
  );
  await wrapper.get("button").trigger("click");
  await wrapper.get('[role="listbox"]').trigger("keydown", { key: "ArrowDown" });
  await wrapper.get('[role="listbox"]').trigger("keydown", { key: "Home" });
  await wrapper.get('[role="listbox"]').trigger("keydown", { key: " " });
  expect(onKeydown).not.toHaveBeenCalled();
});
