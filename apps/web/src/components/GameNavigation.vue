<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";

const props = defineProps<{ gameId: string; activeTab: string }>();
const route = useRoute();
const links = computed(() => {
  const base = `/games/${encodeURIComponent(props.gameId)}`;
  const selected = typeof route.query.match === "string" ? { match: route.query.match } : {};
  return [
    { id: "play", label: "玩法", to: { path: base, query: { ...selected, tab: "play" } } },
    { id: "match", label: "对局", to: { path: base, query: { ...selected, tab: "match" } } },
    { id: "matches", label: "我的比赛", to: { path: `${base}/matches`, query: selected } },
    { id: "leaderboard", label: "排行榜", to: { path: `${base}/leaderboard`, query: selected } },
    { id: "development", label: "开发资料", to: { path: `${base}/development`, query: selected } },
  ];
});
function keydown(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const target = event.currentTarget as HTMLElement;
  const tabs = [...target.querySelectorAll<HTMLElement>('[role="tab"]')];
  const index = tabs.indexOf(event.target as HTMLElement);
  if (index < 0) return;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}
</script>

<template>
  <nav class="game-tabs" role="tablist" aria-label="游戏导航" @keydown="keydown">
    <RouterLink
      v-for="link in links"
      :key="link.id"
      :id="`game-tab-${link.id}`"
      role="tab"
      :aria-selected="activeTab === link.id"
      :aria-controls="`game-panel-${link.id}`"
      :tabindex="activeTab === link.id ? 0 : -1"
      :to="link.to"
      class="shrink-0 whitespace-nowrap border-b-2 px-2 py-3 text-[13px] transition"
      :class="
        activeTab === link.id
          ? 'border-accent font-medium text-accent'
          : 'border-transparent text-soft hover:text-ink'
      "
      >{{ link.label }}</RouterLink
    >
  </nav>
</template>
