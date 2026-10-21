import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadRegisteredReplay } from "@si-arena/player/browser";
import { replayGames } from "../src/games/replays";
import ReplayViewer from "../src/components/ReplayViewer.vue";
import DevPage from "../src/pages/DevPage.vue";
import { replayFixture } from "./replay-fixture";

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("the memory card only appears in live sessions and follows the executed tick", async () => {
  const session = await loadRegisteredReplay(await replayFixture(), replayGames);
  const plain = mount(ReplayViewer, { props: { session, fileName: "match.json.gz" } });
  expect(plain.find('[aria-label="Memory 提交"]').exists()).toBe(false);

  const wrapper = mount(ReplayViewer, {
    props: {
      session,
      fileName: "本地调试会话",
      memory: async (tick, playerId) =>
        playerId === "constructor" ? { before: { n: tick }, after: { n: tick + 1 } } : undefined,
    },
  });
  expect(wrapper.find('[aria-label="Memory 提交"]').exists()).toBe(true);
  expect(wrapper.text()).toContain("前进一步后可查看 tick 0 的 Memory 提交");
  await wrapper.get('[aria-label="前进一个 tick"]').trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("提交前");
  expect(wrapper.text()).toContain("提交后");
  expect(wrapper.text()).toContain('"n": 0');
  expect(wrapper.text()).toContain('"n": 1');
  // Loading a Paper replay validates every tick of the match.
}, 20000);

interface Call {
  url: string;
  method: string;
  body?: string;
}

function jsonResponse(value: unknown) {
  return { ok: true, status: 200, json: async () => value };
}

test("the dev page polls the session, loads the replay and restarts on demand", async () => {
  const raw = await replayFixture();
  const players = [
    { id: "constructor", name: "bot.js", official: false },
    { id: "other", name: "Official", official: true },
  ];
  const result = {
    reason: "tick-limit",
    completedTicks: 3,
    players: [
      { id: "constructor", rank: 1, score: 30 },
      { id: "other", rank: 2, score: 5 },
    ],
  };
  const completed = (run: number) => ({
    game: { id: "paper", name: "圈地", release: "paper@1", botProtocolVersion: 1 },
    current: {
      phase: "completed",
      run,
      seed: 42,
      completedTicks: 3,
      maxTicks: 500,
      players,
      result,
    },
    lastCompleted: { run, matchId: "web-replay", seed: 42, result, finalStateHash: "abc" },
    memoryTruncated: false,
  });
  const running = {
    ...completed(1),
    current: { ...completed(1).current, phase: "running" as const, completedTicks: 1 },
  };
  const statuses = [running, completed(1), completed(2)];
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const call: Call = { url, method: init?.method ?? "GET" };
      if (init?.body !== undefined) call.body = String(init.body);
      calls.push(call);
      if (url === "/api/session") return jsonResponse(statuses.shift() ?? completed(2));
      if (url === "/api/session/replay") return jsonResponse(raw);
      if (url.startsWith("/api/session/memory"))
        return jsonResponse({
          tick: 0,
          players: { constructor: { before: {}, after: { moves: 1 } } },
        });
      if (url === "/api/session/restart") return jsonResponse({ ok: true, run: 2, seed: 42 });
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );

  const wrapper = mount(DevPage);
  await flushPromises();
  expect(wrapper.get('[data-testid="dev-progress"]').text()).toContain("已完成 1 / 500 tick");
  expect(wrapper.text()).toContain("比赛进行中");
  expect(wrapper.find('[aria-label="比赛回放"]').exists()).toBe(false);

  await vi.waitFor(
    () => {
      if (!wrapper.find('[aria-label="比赛回放"]').exists())
        throw new Error("replay viewer not mounted");
    },
    // Loading a Paper replay validates every tick of the match.
    { timeout: 10000 },
  );
  await flushPromises();
  expect(wrapper.text()).toContain("本局已完成");
  expect(wrapper.text()).toContain("第 1 名 · bot.js · 30 分");
  expect(wrapper.find('[aria-label="比赛回放"]').exists()).toBe(true);
  await wrapper.get('[aria-label="前进一个 tick"]').trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain('"moves": 1');

  await wrapper
    .findAll("button")
    .find((button) => button.text() === "重新开局（同种子）")!
    .trigger("click");
  await flushPromises();
  const restartCall = calls.find((call) => call.url === "/api/session/restart");
  expect(restartCall?.method).toBe("POST");
  expect(restartCall?.body).toBeUndefined();

  await wrapper
    .findAll("button")
    .find((button) => button.text() === "换种子重开")!
    .trigger("click");
  await flushPromises();
  const reseedCall = calls.findLast((call) => call.url === "/api/session/restart");
  expect(reseedCall?.body).toBeDefined();
  const seedValue = Number(JSON.parse(reseedCall!.body!).seed);
  expect(seedValue).toBeGreaterThanOrEqual(0);
  expect(seedValue).toBeLessThanOrEqual(0xffffffff);
  // Loading a Paper replay validates every tick of the match.
}, 20000);
