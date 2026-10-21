<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";

defineProps<{ game: GameCatalogEntry; title: string }>();
</script>

<template>
  <header class="flex shrink-0 flex-wrap items-center justify-between gap-3">
    <div class="flex min-w-0 flex-col gap-1">
      <p class="text-[13px] text-faint">
        {{ game.name }} ·
        {{ game.arena ? "竞技场" : game.maxPlayers === 2 ? "1v1 排位" : "排位" }} ·
        {{ game.release }} · 接口 v{{ game.botProtocolVersion }}
      </p>
      <h1 class="text-xl font-bold break-words sm:text-2xl">{{ title }}</h1>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2">
      <slot />
    </div>
  </header>
</template>
