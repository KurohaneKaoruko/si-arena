<script setup lang="ts">
import type { GameCatalogEntry } from '@si-arena/protocol'
import { RouterLink } from 'vue-router'
import { useApiResource } from '../composables/useApiResource.js'

const { data, pending, error, reload } = useApiResource<{ games: GameCatalogEntry[] }>(
  () => '/api/games',
)
</script>

<template>
  <section aria-labelledby="page-title">
    <p class="mb-5 font-mono text-xs tracking-[0.2em] text-arena-accent">CODE. COMPETE. ITERATE.</p>
    <h1
      id="page-title"
      class="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-balance sm:text-6xl"
    >
      让 AI 写策略，<br /><span class="text-arena-accent">让代码决胜负。</span>
    </h1>
    <p class="mt-6 max-w-xl text-base leading-8 text-arena-muted">
      从一段 JavaScript 开始，在小巧而有策略性的游戏中展开对决。观察每个 tick，找到下一次改进。
    </p>
  </section>
  <section class="mt-14" aria-labelledby="games-title" :aria-busy="pending">
    <div class="mb-6 flex items-center justify-between gap-4">
      <h2 id="games-title" class="text-lg font-semibold">选择你的赛场</h2>
      <span class="font-mono text-xs text-arena-muted">GAME LIBRARY</span>
    </div>
    <p v-if="pending" role="status" class="panel p-8 text-arena-muted">正在加载游戏…</p>
    <div v-else-if="error" role="alert" class="panel p-8">
      <p class="text-arena-muted">{{ error }}</p>
      <button class="button-secondary mt-4" type="button" @click="reload">重新加载</button>
    </div>
    <div v-else-if="data?.games.length" class="grid gap-5 md:grid-cols-2">
      <RouterLink
        v-for="(game, index) in data.games"
        :key="game.id"
        :to="{ name: 'game', params: { gameId: game.id } }"
        class="panel group block p-7 transition-colors hover:border-arena-accent/60"
      >
        <div class="mb-8 flex items-start justify-between gap-4">
          <span
            class="flex size-14 items-center justify-center rounded-xl bg-arena-accent/10 font-mono text-xl text-arena-accent"
            aria-hidden="true"
            >{{ String(index + 1).padStart(2, '0') }}</span
          >
          <span
            class="rounded-full border border-arena-border px-3 py-1 font-mono text-xs text-arena-muted"
            >{{ game.minPlayers }} PLAYERS</span
          >
        </div>
        <h3 class="text-2xl font-semibold">{{ game.name }}</h3>
        <p class="mt-3 leading-7 text-arena-muted">{{ game.description }}</p>
        <div
          class="mt-8 flex items-center justify-between gap-4 border-t border-arena-border pt-5 text-sm"
        >
          <span class="font-mono text-arena-muted">{{ game.maxTicks }} TICKS</span>
          <span class="font-medium text-arena-accent"
            >查看规则 <span aria-hidden="true">→</span></span
          >
        </div>
      </RouterLink>
    </div>
    <p v-else class="panel p-8 text-arena-muted">暂无可展示的游戏。</p>
  </section>
</template>
