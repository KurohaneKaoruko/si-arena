import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { paperGame } from "@si-arena/game-paper/game";
import type { ArenaStatusResponse, MatchDetail } from "@si-arena/protocol";
import ArenaPage from "../src/pages/ArenaPage.vue";
import { clearSession, signIn } from "../src/auth/session";

enableAutoUnmount(afterEach);
const user = { id: "me", username: "Me", official: false };
const arena = { seats: 5, keepMatches: 3 };
const royale = {
  ...paperGame.manifest,
  id: "royale",
  name: "圈地大逃杀",
  // Not a registered release, so the page must list runs without downloading them.
  release: "royale@0.0.0-unregistered",
  arena,
};
const date = "2026-10-21T00:00:00.000Z";
function run(id: string, status: MatchDetail["status"]): MatchDetail {
  return {
    id,
    gameId: "royale",
    kind: "arena",
    status,
    release: royale.release,
    seed: 1,
    initiatorId: "a",
    createdAt: date,
    updatedAt: date,
    participants: ["a", "b"].map((name, slot) => ({
      userId: name,
      username: name.toUpperCase(),
      official: false,
      boss: false,
      slot,
      ...(status === "completed" ? { rank: slot + 1 } : {}),
    })),
    ...(status === "completed"
      ? {
          result: {
            reason: "last-alive",
            completedTicks: 300,
            players: [
              { id: "a", rank: 1, score: 40 },
              { id: "b", rank: 2, score: 0 },
            ],
          },
        }
      : {}),
  };
}
const lineup = ["a", "b"].map((name) => ({
  userId: name,
  username: name.toUpperCase(),
  official: false,
  rating: 1016,
  wins: 1,
  matchesPlayed: 2,
  codeUpdatedAt: date,
}));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  clearSession();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  clearSession();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup() {
  let status: ArenaStatusResponse = { active: null, lineup, recent: [run("done", "completed")] };
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/auth/login") return response({ user, token: "a".repeat(43) });
    if (url === "/api/games") return response({ games: [paperGame.manifest, royale] });
    if (url === "/api/games/royale/arena" && options?.method === "POST") {
      // Another user started a run first.
      status = { ...status, active: run("live", "running") };
      return response({ code: "ARENA_BUSY", message: "竞技场正在运行", matchId: "live" }, 409);
    }
    if (url === "/api/games/royale/arena") return response(status);
    return response({ message: "不存在" }, 404);
  });
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "me", "secret");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<p />" } }],
  });
  await router.push("/games/royale/arena");
  vi.useFakeTimers();
  const wrapper = mount(ArenaPage, { props: { gameId: "royale" }, global: { plugins: [router] } });
  await flushPromises();
  const reads = () =>
    fetch.mock.calls.filter(
      ([url, options]) => url === "/api/games/royale/arena" && options?.method !== "POST",
    ).length;
  return { wrapper, fetch, reads };
}

test("a busy arena shows the running run and disables starting another", async () => {
  const { wrapper, fetch, reads } = await setup();
  expect(wrapper.text()).toContain("竞技场空闲");
  expect(wrapper.text()).toContain("下一局阵容");
  // Lineup seats show the arena Elo rating, not legacy points.
  expect(wrapper.text()).toContain("排位分");
  expect(wrapper.text()).toContain("1016.00");
  // Idle arenas refresh every 15 s.
  expect(reads()).toBe(1);
  await vi.advanceTimersByTimeAsync(15000);
  expect(reads()).toBe(2);
  const start = wrapper.findAll("button").find((button) => button.text() === "开一局")!;
  expect(start.attributes("disabled")).toBeUndefined();
  await start.trigger("click");
  await flushPromises();
  expect(
    fetch.mock.calls.some(
      ([url, options]) =>
        url === "/api/games/royale/arena" &&
        options?.method === "POST" &&
        new Headers(options.headers).get("Idempotency-Key"),
    ),
  ).toBe(true);
  expect(wrapper.text()).toContain("正在运行");
  const busy = wrapper.findAll("button").find((button) => button.text() === "本局跑完前不能再开")!;
  expect(busy.attributes("disabled")).toBeDefined();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  // A running arena refreshes every 3 s.
  const before = reads();
  await vi.advanceTimersByTimeAsync(3000);
  expect(reads()).toBe(before + 1);
});

test("runs of a release without a registered renderer are listed but never downloaded", async () => {
  const { wrapper, fetch } = await setup();
  expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toContain("冠军 A");
  expect(wrapper.text()).toContain("此发行的画面尚未注册");
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/replay"))).toBe(false);
});
