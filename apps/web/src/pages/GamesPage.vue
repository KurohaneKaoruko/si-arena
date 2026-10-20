<script setup lang="ts">
import { parseGames } from "../api/contracts";
import { RouterLink } from "vue-router";
import { useApiResource } from "../composables/useApiResource";
import StateBlock from "../components/ui/StateBlock.vue";

const { data, status, empty, error, reload } = useApiResource(() => "/api/games", parseGames, {
  isEmpty: (value) => value.games.length === 0,
});
</script>

<template>
  <div>
    <section aria-labelledby="games-title">
      <h1 id="games-title" class="text-2xl font-semibold tracking-tight">游戏大厅</h1>
      <StateBlock v-if="status === 'loading'" class="mt-4" status="loading" />
      <StateBlock
        v-else-if="status === 'error'"
        class="mt-4"
        status="error"
        :message="error"
        @retry="reload"
      />
      <StateBlock v-else-if="empty" class="mt-4" status="empty" message="暂时还没有可玩的游戏。" />
      <ul v-else class="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <li
          v-for="game in data?.games ?? []"
          :key="game.id"
          class="rounded-card border border-line bg-surface"
        >
          <RouterLink
            :to="{ name: 'game', params: { gameId: game.id } }"
            class="group block p-5 transition hover:bg-subtle"
          >
            <div class="flex items-center justify-between gap-4">
              <h3 class="text-lg font-semibold tracking-tight">{{ game.name }}</h3>
              <span
                class="shrink-0 text-accent transition group-hover:translate-x-0.5"
                aria-hidden="true"
                >→</span
              >
            </div>
            <p class="mt-1.5 text-sm leading-6 text-soft">{{ game.description }}</p>
            <p class="mt-4 font-mono text-xs text-faint">
              {{ game.minPlayers }} 人 · {{ game.maxTicks }} tick
            </p>
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>
