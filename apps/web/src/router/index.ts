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
      path: "/games/:gameId/leaderboard",
      component: () => import("../pages/LeaderboardPage.vue"),
      meta: { title: "排行榜" },
    },
    {
      path: "/games/:gameId/matches",
      component: () => import("../pages/HistoryPage.vue"),
      meta: { title: "我的比赛" },
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
  scrollBehavior: (to) => (to.hash ? { el: to.hash } : { top: 0 }),
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "游戏大厅")} · SI Arena`;
});
