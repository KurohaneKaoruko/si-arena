<script setup lang="ts">
import type { MatchDetail } from "@si-arena/protocol";
import { computed } from "vue";
import { session } from "../auth/session";
import { isUnscored, kindLabel, matchOutcome, ratingDelta } from "../games/match-summary";
import ParticipantTags from "./ParticipantTags.vue";
import AppBadge from "./ui/AppBadge.vue";

const props = defineProps<{ match: MatchDetail }>();
const self = computed(() => props.match.participants.find((p) => p.userId === session.user?.id));
const outcome = computed(() => matchOutcome(props.match, session.user?.id));
const players = computed(() => props.match.participants.toSorted((a, b) => a.slot - b.slot));
const unscored = computed(() => isUnscored(props.match));
const labels = {
  pending: "等待开局",
  running: "比赛进行中",
  completed: "比赛结束",
  failed: "比赛失败",
} as const;
const title = computed(() => {
  if (props.match.status === "completed" && self.value) {
    const result = outcome.value.label;
    return result === "获胜" || result === "失利" ? `你${result}` : result;
  }
  return labels[props.match.status];
});
const delta = computed(() => ratingDelta(self.value));
function score(userId: string) {
  return props.match.result?.players.find((player) => player.id === userId)?.score;
}
</script>

<template>
  <section class="min-w-0 space-y-3" aria-label="比赛结果与信息">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2
        class="flex items-center gap-2 text-[28px] leading-tight font-black"
        :class="{
          'text-accent': outcome.tone === 'success',
          'text-danger-ink': outcome.tone === 'danger',
        }"
      >
        {{ title }}
        <AppBadge v-if="kindLabel(match.kind)" tone="outline">{{ kindLabel(match.kind) }}</AppBadge>
      </h2>
      <span v-if="match.status === 'completed' && unscored" class="text-sm text-soft">不计分</span>
      <span
        v-else-if="match.status === 'completed' && self?.ratingAfter !== undefined"
        class="font-mono text-sm text-soft"
        >排位 {{ self.ratingAfter.toFixed(2) }}
        <b :class="delta.startsWith('-') ? 'text-danger-ink' : 'text-accent'">{{ delta }}</b></span
      >
    </div>
    <ul class="space-y-2">
      <li
        v-for="p in players"
        :key="p.userId"
        class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-panel bg-subtle p-3"
      >
        <span
          class="grid size-9 place-items-center rounded-[0.5rem] border-2 font-display font-bold"
          :style="{
            color: `var(--color-player-${p.slot})`,
            borderColor: `var(--color-player-${p.slot})`,
            backgroundColor: `color-mix(in srgb, var(--color-player-${p.slot}) 12%, transparent)`,
          }"
          >P{{ p.slot + 1 }}</span
        >
        <span class="min-w-0">
          <span class="flex flex-wrap items-center gap-1.5 font-bold break-all"
            >{{ p.username }} <ParticipantTags :player="p"
          /></span>
          <span
            v-if="!unscored && p.ratingAfter !== undefined"
            class="mt-0.5 block font-mono text-xs text-faint"
            >排位 {{ p.ratingBefore?.toFixed(2) }} → {{ p.ratingAfter.toFixed(2) }}</span
          >
        </span>
        <span v-if="match.status === 'completed'" class="text-right">
          <span class="figure text-[22px]" :style="{ color: `var(--color-player-${p.slot})` }">{{
            score(p.userId) ?? "—"
          }}</span
          ><span class="text-xs text-faint"> 分</span>
          <span
            v-if="p.rank"
            class="block text-xs"
            :class="p.rank === 1 ? 'text-accent' : 'text-soft'"
            >第 {{ p.rank }} 名</span
          >
        </span>
        <span v-else class="text-xs text-soft">席位 {{ p.slot + 1 }}</span>
      </li>
    </ul>
    <details class="rounded-panel border border-line px-4 py-3">
      <summary class="cursor-pointer text-sm font-bold">
        比赛信息{{ match.result ? ` · ${match.result.completedTicks} tick` : "" }}
      </summary>
      <dl
        class="mt-2.5 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 font-mono text-xs text-soft"
      >
        <dt class="font-sans text-faint">ID</dt>
        <dd class="break-all">{{ match.id }}</dd>
        <dt class="font-sans text-faint">发行</dt>
        <dd>{{ match.release }}</dd>
        <dt class="font-sans text-faint">种子</dt>
        <dd>{{ match.seed }}</dd>
        <dt class="font-sans text-faint">更新时间</dt>
        <dd>
          <time :datetime="match.updatedAt">{{
            new Date(match.updatedAt).toLocaleString("zh-CN")
          }}</time>
        </dd>
      </dl>
    </details>
  </section>
</template>
