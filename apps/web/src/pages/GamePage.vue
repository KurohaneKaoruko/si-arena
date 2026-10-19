<script setup lang="ts">
import { parseGame } from "../api/contracts";
import { session } from "../auth/session";
import AccountGate from "../components/AccountGate.vue";
import GameEntry from "../components/GameEntry.vue";
import GameDevelopment from "../components/GameDevelopment.vue";
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useApiResource } from "../composables/useApiResource";
import { gamePresentations } from "../games/index";
import AppButton from "../components/ui/AppButton.vue";
import AppCard from "../components/ui/AppCard.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import StateBlock from "../components/ui/StateBlock.vue";
import StatGrid from "../components/ui/StatGrid.vue";

const route = useRoute();
const path = computed(() => `/api/games/${encodeURIComponent(String(route.params.gameId))}`);
const { data: game, status, error, reload } = useApiResource(() => path.value, parseGame);
const presentation = computed(() => gamePresentations.get(String(route.params.gameId)));
const stats = computed(() =>
  game.value && presentation.value ? presentation.value.getStats(game.value) : [],
);
const links = computed(() => {
  const id = String(route.params.gameId);
  const base = `/games/${encodeURIComponent(id)}`;
  return [
    { label: "开发资料", to: `${base}#development` },
    { label: "排行榜", to: `${base}/leaderboard` },
    { label: "我的比赛", to: `${base}/matches` },
  ];
});
</script>

<template>
  <div>
    <RouterLink
      to="/"
      class="inline-flex items-center gap-1 text-sm text-soft transition hover:text-ink"
      >← 游戏大厅</RouterLink
    >
    <div class="mt-6">
      <StateBlock v-if="status === 'loading'" status="loading" />
      <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
      <template v-else-if="game">
        <PageHeader :title="game.name" :description="game.description">
          <template #actions>
            <AppButton variant="primary" size="lg" href="#participate">上传与参赛</AppButton>
          </template>
        </PageHeader>
        <nav class="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="游戏导航">
          <RouterLink
            v-for="link in links"
            :key="link.label"
            :to="link.to"
            class="text-sm text-soft transition hover:text-ink"
            >{{ link.label }}</RouterLink
          >
        </nav>
        <StatGrid v-if="stats.length" class="mt-8" :items="stats" />
        <AppCard v-if="presentation" class="mt-8" :title="presentation.headline">
          <ol class="space-y-3 leading-7 text-soft">
            <li
              v-for="instruction in presentation.instructions"
              :key="instruction"
              class="flex gap-3"
            >
              <span class="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
              <span>{{ instruction }}</span>
            </li>
          </ol>
        </AppCard>
        <GameDevelopment :key="`${game.id}:${game.release}`" :game="game" />
        <AppCard id="participate" class="mt-8 scroll-mt-20" title="我的参赛策略">
          <AccountGate
            ><GameEntry :key="`${game.id}:${session.user?.id}`" :game="game"
          /></AccountGate>
        </AppCard>
      </template>
    </div>
  </div>
</template>
