<script setup lang="ts">
import { parseGames } from "../api/contracts";
import { RouterLink } from "vue-router";
import { useApiResource } from "../composables/useApiResource";
import PageHeader from "../components/ui/PageHeader.vue";
import StateBlock from "../components/ui/StateBlock.vue";

const { data, status, empty, error, reload } = useApiResource(() => "/api/games", parseGames, {
  isEmpty: (value) => value.games.length === 0,
});
</script>

<template>
  <div>
    <PageHeader
      title="让 AI 写策略，让代码决胜负"
      description="上传 JavaScript 策略，主动发起匹配。代码在沙箱中逐 tick 执行，每一步都算得清。"
    />
    <section class="mt-12" aria-labelledby="games-title">
      <h2 id="games-title" class="text-sm font-medium text-soft">全部游戏</h2>
      <StateBlock v-if="status === 'loading'" class="mt-4" status="loading" />
      <StateBlock
        v-else-if="status === 'error'"
        class="mt-4"
        status="error"
        :message="error"
        @retry="reload"
      />
      <StateBlock v-else-if="empty" class="mt-4" status="empty" message="暂时还没有可玩的游戏。" />
      <ul
        v-else
        class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card"
      >
        <li
          v-for="game in data?.games ?? []"
          :key="game.id"
          class="border-b border-line last:border-b-0"
        >
          <RouterLink
            :to="{ name: 'game', params: { gameId: game.id } }"
            class="group block p-5 transition hover:bg-subtle"
          >
            <div class="flex items-center justify-between gap-4">
              <h3 class="text-lg font-semibold tracking-tight">{{ game.name }}</h3>
              <span
                class="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden="true"
                >→</span
              >
            </div>
            <p class="mt-1.5 text-sm leading-6 text-soft">{{ game.description }}</p>
            <p class="mt-4 font-mono text-xs text-faint">
              {{ game.minPlayers }} PLAYERS · {{ game.maxTicks }} TICKS
            </p>
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>
