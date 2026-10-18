import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { afterEach, expect, test } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import App from "../src/App.vue";
import NotFoundPage from "../src/pages/NotFoundPage.vue";

enableAutoUnmount(afterEach);

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
  const returnLink = wrapper.get("a.button-secondary");
  expect(returnLink.attributes("href")).toBe("/");
  await returnLink.trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.path).toBe("/");
  expect(wrapper.get("main h1").text()).toBe("游戏大厅");
  expect(wrapper.get("a.skip-link").attributes("href")).toBe("#main-content");
});
