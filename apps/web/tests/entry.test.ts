import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { paperGame } from "@si-arena/game-paper/game";
import GameEntry from "../src/components/GameEntry.vue";
import { clearSession, signIn } from "../src/auth/session";

const user = { id: "player", username: "player", official: false };
const game = paperGame.manifest;
const code = {
  source: 'export default () => ({ type: "idle" })',
  sourceBytes: 41,
  botProtocolVersion: 1,
  updatedAt: new Date().toISOString(),
};
const me = {
  entry: { rating: 1000, matchesPlayed: 0, wins: 0, draws: 0, losses: 0 },
  code,
  canMatch: true,
  cannotMatchReason: null,
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  clearSession();
  localStorage.clear();
});
afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});
async function setup(fetch: ReturnType<typeof vi.fn>) {
  fetch.mockResolvedValueOnce(response({ user, token: "a".repeat(43) }));
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "player", "secret");
  fetch.mockResolvedValueOnce(response(me));
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: {} },
      { path: "/matches/:id", component: {} },
    ],
  });
  await router.push("/");
  const wrapper = mount(GameEntry, { props: { game }, global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

test("a lost match response retries the same idempotency key and existing matches are reused", async () => {
  const fetch = vi.fn();
  const { wrapper, router } = await setup(fetch);
  fetch
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(
      response({ code: "MATCH_ALREADY_PENDING", message: "已有比赛", matchId: "existing" }, 409),
    );
  const button = wrapper.findAll("button").find((candidate) => candidate.text() === "发起匹配")!;
  await button.trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("网络连接失败");
  await button.trigger("click");
  await flushPromises();
  const calls = fetch.mock.calls.filter((call) => String(call[0]).endsWith("/matches"));
  expect(calls).toHaveLength(2);
  const keys = calls.map((call) =>
    new Headers(call[1].headers as HeadersInit).get("Idempotency-Key"),
  );
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(router.currentRoute.value.path).toBe("/matches/existing");
  wrapper.unmount();
});

test("uploading never creates a match, and a rejected upload preserves the current code", async () => {
  const fetch = vi.fn();
  const { wrapper } = await setup(fetch);
  const input = wrapper.get("input[type=file]");
  const text = 'export default () => ({type:"idle"})';
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [
      {
        name: "bot.js",
        size: text.length,
        arrayBuffer: async () => new TextEncoder().encode(text).buffer,
      },
    ],
  });
  await input.trigger("change");
  await flushPromises();
  const button = wrapper.findAll("button").find((candidate) => candidate.text() === "上传并替换")!;
  fetch.mockResolvedValueOnce(response({ code: "CODE_INVALID", message: "无效代码" }, 400));
  await button.trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("无效代码");
  expect(wrapper.get("pre").text()).toBe(code.source);
  fetch
    .mockResolvedValueOnce(response(code))
    .mockResolvedValueOnce(response({ ...me, code: { ...code, source: text } }));
  await button.trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("最新代码已保存");
  expect(wrapper.get("pre").text()).toBe(text);
  expect(fetch.mock.calls.some((call) => String(call[0]).endsWith("/matches"))).toBe(false);
  wrapper.unmount();
});

test("invalid UTF-8 and oversized files never reach the upload endpoint", async () => {
  const fetch = vi.fn();
  const { wrapper } = await setup(fetch);
  const input = wrapper.get("input[type=file]");
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [{ name: "bad.js", size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer }],
  });
  await input.trigger("change");
  await flushPromises();
  expect(wrapper.text()).toContain("UTF-8");
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [{ name: "large.js", size: game.resolvedLimits.codeBytes + 1 }],
  });
  await input.trigger("change");
  await flushPromises();
  expect(wrapper.text()).toContain("文件超过");
  expect(fetch).toHaveBeenCalledTimes(2);
  wrapper.unmount();
});
