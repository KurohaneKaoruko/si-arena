<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useApiResource } from "../composables/useApiResource";
import { gamePresentations } from "../games/index";

const route = useRoute();
const path = computed(() => `/api/games/${encodeURIComponent(String(route.params.gameId))}`);
const { data: game, pending, error, reload } = useApiResource<GameCatalogEntry>(() => path.value);
const presentation = computed(() => gamePresentations.get(String(route.params.gameId)));
const stats = computed(() =>
  game.value && presentation.value ? presentation.value.getStats(game.value) : [],
);
</script>

<template>
  <RouterLink
    to="/"
    class="mb-9 inline-flex min-h-11 items-center text-sm text-arena-muted hover:text-arena-text"
    >← 返回游戏大厅</RouterLink
  >
  <p v-if="pending" role="status" class="panel p-8 text-arena-muted">正在加载游戏…</p>
  <div v-else-if="error" role="alert" class="panel p-8">
    <p class="text-arena-muted">{{ error }}</p>
    <button class="button-secondary mt-4" type="button" @click="reload">重新加载</button>
  </div>
  <article v-else-if="game">
    <p class="mb-4 font-mono text-xs tracking-[0.2em] text-arena-accent">
      {{ game.id.toUpperCase() }}
    </p>
    <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">{{ game.name }}</h1>
    <p class="mt-5 max-w-2xl leading-8 text-arena-muted">{{ game.description }}</p>
    <dl class="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div v-for="stat in stats" :key="stat.label" class="panel p-5">
        <dt class="text-sm text-arena-muted">{{ stat.label }}</dt>
        <dd class="mt-2 font-mono text-2xl">{{ stat.value }}</dd>
      </div>
    </dl>
    <section v-if="presentation" class="panel mt-8 p-7 sm:p-9" aria-labelledby="rules-title">
      <h2 id="rules-title" class="text-xl font-semibold">{{ presentation.headline }}</h2>
      <ol class="mt-6 list-inside list-decimal space-y-4 leading-8 text-arena-muted">
        <li v-for="instruction in presentation.instructions" :key="instruction">
          {{ instruction }}
        </li>
      </ol>
    </section>
  </article>
</template>
