import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/login",
      component: () => import("../pages/AuthPage.vue"),
      props: { mode: "login" },
      meta: { title: "登录" },
    },
    {
      path: "/register",
      component: () => import("../pages/AuthPage.vue"),
      props: { mode: "register" },
      meta: { title: "注册" },
    },
    {
      path: "/account",
      component: () => import("../pages/AccountPage.vue"),
      meta: { title: "账号设置" },
    },
    {
      path: "/matches/:matchId",
      component: () => import("../pages/MatchPage.vue"),
      meta: { title: "比赛详情" },
    },
    {
      path: "/replays",
      name: "replay",
      component: () => import("../pages/ReplayPage.vue"),
      meta: { title: "回放播放器" },
    },
    {
      path: "/",
      name: "games",
      component: () => import("../pages/GamesPage.vue"),
      meta: { title: "游戏大厅" },
    },
    {
      path: "/games/:gameId",
      component: () => import("../pages/GameLayout.vue"),
      children: [
        {
          path: "",
          name: "game",
          component: () => import("../pages/GamePage.vue"),
          meta: { title: "赛场" },
        },
        {
          path: "matches",
          component: () => import("../pages/HistoryPage.vue"),
          meta: { title: "我的比赛" },
        },
        {
          path: "leaderboard",
          component: () => import("../pages/LeaderboardPage.vue"),
          meta: { title: "排行榜" },
        },
        {
          path: "development",
          component: () => import("../components/GameDevelopment.vue"),
          meta: { title: "开发资料" },
        },
        {
          path: "rules",
          component: () => import("../pages/GameRulesPage.vue"),
          meta: { title: "规则" },
        },
      ],
    },
    {
      path: "/:pathMatch(.*)*",
      name: "not-found",
      component: () => import("../pages/NotFoundPage.vue"),
      meta: { title: "页面不存在" },
    },
  ],
  scrollBehavior: async (to, from, saved) => {
    if (saved) return saved;
    if (to.hash) {
      // The game layout may still be fetching before the anchor exists.
      for (let attempt = 0; attempt < 30; attempt++) {
        if (document.getElementById(to.hash.slice(1))) return { el: to.hash };
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (to.name === "game" && to.query.match !== from.query.match) return { top: 0 };
    if (to.params.gameId && to.params.gameId === from.params.gameId) return false;
    return { top: 0 };
  },
});

router.beforeEach((to) => {
  if (to.hash === "#development" && /^\/games\/[^/]+\/?$/.test(to.path))
    return { path: `${to.path.replace(/\/$/, "")}/development`, query: to.query, replace: true };
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "游戏大厅")} · SI Arena`;
});
