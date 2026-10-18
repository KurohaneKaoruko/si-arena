import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "games",
      component: () => import("../pages/GamesPage.vue"),
      meta: { title: "游戏大厅" },
    },
    {
      path: "/games/:gameId",
      name: "game",
      component: () => import("../pages/GamePage.vue"),
      meta: { title: "游戏规则" },
    },
    {
      path: "/:pathMatch(.*)*",
      name: "not-found",
      component: () => import("../pages/NotFoundPage.vue"),
      meta: { title: "页面不存在" },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "游戏大厅")} · SI Arena`;
});
