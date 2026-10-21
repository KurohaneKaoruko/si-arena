<script setup lang="ts">
import { computed } from "vue";
import type { BrowserReplaySession, ReplayView } from "@si-arena/player/browser";

const props = defineProps<{ session: BrowserReplaySession; view: ReplayView; tick: number }>();
const names = computed(
  () => new Map(props.session.replay.players.map((player) => [player.id, player])),
);
const finished = computed(() => props.tick === props.session.totalTicks);
const ranking = computed(() =>
  props.session.replay.result.players.toSorted((a, b) => a.rank - b.rank),
);
</script>

<template>
  <section class="card p-5" aria-labelledby="scoreboard-title">
    <h2 id="scoreboard-title" class="text-base font-bold">
      {{ view.players.length > 2 ? "存活与名次" : "当前比分" }}
    </h2>
    <ul class="mt-3 space-y-2">
      <li
        v-for="player in view.players"
        :key="player.id"
        class="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-control bg-subtle px-3 py-2.5"
        :class="{ 'opacity-60': !player.alive }"
      >
        <span
          class="grid size-8 place-items-center rounded-[0.5rem] border-2 font-display text-sm font-bold"
          :style="{
            color: player.color,
            borderColor: player.color,
            backgroundColor: `color-mix(in srgb, ${player.color} 12%, transparent)`,
          }"
          >{{ player.label }}</span
        >
        <span class="min-w-0">
          <span class="block truncate font-semibold" :title="names.get(player.id)?.name">{{
            names.get(player.id)?.name
          }}</span>
          <span class="block text-xs" :class="player.alive ? 'text-accent' : 'text-danger-ink'"
            >{{ names.get(player.id)?.official ? "官方 · " : ""
            }}{{ player.alive ? "存活" : "已淘汰" }}</span
          >
        </span>
        <span class="figure text-lg" :style="{ color: player.color }"
          >{{ player.score
          }}<span class="ml-1 font-sans text-xs font-normal text-faint">{{
            session.scoreUnit
          }}</span></span
        >
      </li>
    </ul>
    <div v-if="finished" class="mt-4 border-t border-line pt-3.5">
      <h3 class="text-sm font-bold">终局排名</h3>
      <ol class="mt-2 space-y-1 text-sm text-soft">
        <li v-for="result in ranking" :key="result.id" class="break-words">
          第 {{ result.rank }} 名 · {{ names.get(result.id)?.name }} · {{ result.score }}
          {{ session.scoreUnit }}
        </li>
      </ol>
    </div>
  </section>
</template>
