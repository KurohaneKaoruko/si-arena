import { webcrypto } from "node:crypto";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadRegisteredReplay } from "@si-arena/player/browser";
import { replayGames } from "../src/games/replays";
import ReplayViewer from "../src/components/ReplayViewer.vue";
import ReplayPage from "../src/pages/ReplayPage.vue";
import { replayFixture } from "./replay-fixture";

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test("timeline, keyboard and error navigation preserve S0/input tick semantics and escape player logs", async () => {
  const session = await loadRegisteredReplay(await replayFixture(), replayGames);
  const wrapper = mount(ReplayViewer, { props: { session, fileName: "match.json.gz" } });
  expect(wrapper.get('[data-testid="tick-count"]').text()).toContain("已完成 0");
  expect(wrapper.text()).toContain("初始世界 S0");
  await wrapper.get('[aria-label="前进一个 tick"]').trigger("click");
  expect(wrapper.get('[data-testid="tick-count"]').text()).toContain("已完成 1");
  expect(wrapper.text()).toContain("执行 tick 0 → 世界 S1");
  expect(wrapper.text()).toContain("<img src=x onerror=alert(1)>");
  expect(wrapper.find("img").exists()).toBe(false);
  expect(wrapper.find("script").exists()).toBe(false);
  expect(wrapper.text()).toContain("1.23 ms");
  await wrapper.get("#log-level").trigger("click");
  await wrapper.get('[role="option"][data-value="warn"]').trigger("click");
  expect(wrapper.text()).toContain("watch the trail");
  expect(wrapper.text()).not.toContain("<img src=x onerror=alert(1)>");
  await wrapper.get('[aria-label="回到初始世界"]').trigger("click");
  const nextError = wrapper.findAll("button").find((button) => button.text() === "下一处错误")!;
  await nextError.trigger("click");
  expect(wrapper.get("#diagnostic-player").text()).toContain("Official");
  expect(wrapper.text()).toContain("test failure");
  await wrapper.get("canvas").trigger("keydown", { key: "End" });
  expect(wrapper.text()).toContain("终局排名");
  await wrapper.get("canvas").trigger("keydown", { key: "Home" });
  expect(wrapper.get('[data-testid="tick-count"]').text()).toContain("已完成 0");
  await wrapper.get("#replay-tick").setValue(3);
  expect(wrapper.get('[data-testid="tick-count"]').text()).toContain("已完成 3");
});

test("missing logs for prototype-named participants remain empty rather than inherited values", async () => {
  const raw = await replayFixture();
  for (const tick of raw.ticks) {
    delete tick.logs;
  }
  const session = await loadRegisteredReplay(raw, replayGames);
  const wrapper = mount(ReplayViewer, { props: { session, fileName: "match.json.gz" } });
  await wrapper.get('[aria-label="前进一个 tick"]').trigger("click");
  expect(wrapper.text()).toContain("此回放未包含玩家日志");
  expect(wrapper.find("#log-level").exists()).toBe(false);
  expect(wrapper.find('[aria-label="玩家执行错误"]').exists()).toBe(false);
});

test("leaving the viewer cancels playback and hidden tabs pause it", async () => {
  const session = await loadRegisteredReplay(await replayFixture(), replayGames);
  const wrapper = mount(ReplayViewer, { props: { session, fileName: "match.json.gz" } });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "播放")!
    .trigger("click");
  expect(requestAnimationFrame).toHaveBeenCalledOnce();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  await flushPromises();
  expect(wrapper.text()).toContain("已暂停");
  expect(cancelAnimationFrame).toHaveBeenCalled();
});

test("keys pressed inside the select popup do not drive the replay", async () => {
  const session = await loadRegisteredReplay(await replayFixture(), replayGames);
  const wrapper = mount(ReplayViewer, { props: { session, fileName: "match.json.gz" } });
  await wrapper.get("#log-level").trigger("click");
  const listbox = wrapper.get('[role="listbox"]');
  // Home / End / 空格是播放器的快捷键，在下拉框里按不能改播放位置、也不能启停
  await listbox.trigger("keydown", { key: "End" });
  expect(wrapper.get('[data-testid="tick-count"]').text()).toContain("已完成 0");
  await listbox.trigger("keydown", { key: " " });
  await flushPromises();
  expect(wrapper.get('[data-testid="tick-count"]').text()).toContain("已完成 0");
  expect(wrapper.text()).not.toContain("播放中");
});

test("the timeline slider seeks the replay without starting playback", async () => {
  const session = await loadRegisteredReplay(await replayFixture(), replayGames);
  const wrapper = mount(ReplayViewer, { props: { session, fileName: "match.json.gz" } });
  const slider = wrapper.get('[role="slider"]');
  expect(slider.attributes("aria-valuemin")).toBe("0");
  expect(slider.attributes("aria-valuemax")).toBe(String(session.totalTicks));
  expect(slider.attributes("aria-valuetext")).toContain("已完成 0");

  await slider.trigger("keydown", { key: "ArrowRight" });
  await flushPromises();
  expect(wrapper.get('[data-testid="tick-count"]').text()).toContain("已完成 1");

  // 滑块消费掉的按键不能顺带启停回放
  await slider.trigger("keydown", { key: " " });
  await flushPromises();
  expect(wrapper.text()).not.toContain("播放中");
});

test("file opening failures show an error without an old or partially verified match", async () => {
  const wrapper = mount(ReplayPage);
  expect(wrapper.text()).toContain("打开 .json.gz 回放文件");
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: [new File(["bad gzip"], "bad.json.gz")],
    configurable: true,
  });
  await input.trigger("change");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("无法播放");
  expect(wrapper.find('[aria-label="比赛回放"]').exists()).toBe(false);
});

test("online replays omit console tools while preserving execution errors and observation", async () => {
  const session = await loadRegisteredReplay(await replayFixture(), replayGames);
  const wrapper = mount(ReplayViewer, {
    props: { session, fileName: "online.json.gz", sourceKind: "online" },
  });
  expect(wrapper.find("#log-level").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("玩家日志");
  expect(wrapper.text()).not.toContain("online.json.gz");
  const nextError = wrapper.findAll("button").find((button) => button.text() === "下一处错误")!;
  await nextError.trigger("click");
  expect(wrapper.text()).toContain("test failure");
  expect(wrapper.text()).toContain("查看执行前的观察");
});
