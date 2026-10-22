import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { paperGame } from "@si-arena/game-paper/game";
import App from "../src/App.vue";
import NotFoundPage from "../src/pages/NotFoundPage.vue";

enableAutoUnmount(afterEach);
const arena = { seats: 5, keepMatches: 3 };
const royale = { ...paperGame.manifest, id: "royale", name: "圈地大逃杀", arena };
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ games: [paperGame.manifest, royale] }))),
  );
});
afterEach(() => vi.unstubAllGlobals());

test("an unknown route can return to the lobby through the rendered navigation link", async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => h("h1", "游戏大厅") } },
      { path: "/:pathMatch(.*)*", component: NotFoundPage },
    ],
  });
  await router.push("/missing");
  const wrapper = mount(App, { global: { plugins: [router] } });
  expect(wrapper.get("main").text()).toContain("这个赛场不存在");
  const returnLink = wrapper.get('main a[href="/"]');
  expect(returnLink.attributes("href")).toBe("/");
  await returnLink.trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.path).toBe("/");
  expect(wrapper.get("main h1").text()).toBe("游戏大厅");
  expect(wrapper.get("a.skip-link").attributes("href")).toBe("#main-content");
});

test("the header resolves the duel and arena entries from the catalog", async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { render: () => h("h1", "页面") } }],
  });
  await router.push("/royale");
  const wrapper = mount(App, { global: { plugins: [router] } });
  await flushPromises();
  const nav = wrapper.get('nav[aria-label="主导航"]');
  expect(nav.get('a[href="/games/paper"]').text()).toBe("圈地 1v1");
  const royaleLink = nav.get('a[href="/royale"]');
  expect(royaleLink.text()).toContain("新");
  expect(royaleLink.attributes("aria-current")).toBe("page");
  const toggle = wrapper.get('button[aria-controls="site-menu"]');
  expect(toggle.attributes("aria-expanded")).toBe("false");
  await toggle.trigger("click");
  expect(toggle.attributes("aria-expanded")).toBe("true");
  await nav.get('a[href="/leaderboard"]').trigger("click");
  await flushPromises();
  expect(toggle.attributes("aria-expanded")).toBe("false");
  expect(nav.get('a[href="/leaderboard"]').attributes("aria-current")).toBe("page");
});
