<script setup lang="ts">
import type { MatchDetail } from "@si-arena/protocol";
import { computed } from "vue";
import { session } from "../auth/session";
import { matchOutcome, ratingDelta } from "../games/match-summary";
import AppBadge from "./ui/AppBadge.vue";

const props = defineProps<{ match: MatchDetail }>();
const self = computed(() => props.match.participants.find((p) => p.userId === session.user?.id));
const outcome = computed(() => matchOutcome(props.match, session.user?.id));
const title = computed(() => {
  if (props.match.status === "completed" && self.value) {
    const result = outcome.value?.label;
    return result === "获胜" || result === "失利" ? `你${result}` : result;
  }
  return labels[props.match.status];
});
const labels = {
  pending: "等待开局",
  running: "比赛进行中",
  completed: "比赛结束",
  failed: "比赛失败",
} as const;
</script>

<template>
  <section
    class="min-w-0 rounded-card border border-line bg-surface p-4 shadow-card"
    aria-label="比赛结果与信息"
  >
    <div class="flex flex-wrap items-center gap-3">
      <h2
        class="text-2xl font-semibold tracking-tight"
        :class="
          outcome?.tone === 'success'
            ? 'text-success'
            : outcome?.tone === 'danger'
              ? 'text-danger'
              : ''
        "
      >
        {{ title }}
      </h2>
      <span v-if="match.status === 'completed' && self" class="font-mono text-sm"
        >排位 {{ self.ratingAfter?.toFixed(2) ?? "—" }}
        <span :class="ratingDelta(self).startsWith('-') ? 'text-danger' : 'text-success'">{{
          ratingDelta(self)
        }}</span></span
      >
    </div>
    <div class="mt-4 space-y-3">
      <section
        v-for="p in match.participants"
        :key="p.userId"
        class="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
      >
        <div class="min-w-0">
          <h3 class="break-all text-sm font-medium">
            {{ p.username }} <AppBadge v-if="p.official" class="ml-1">官方</AppBadge
            ><span v-if="p.userId === session.user?.id" class="ml-1 text-xs text-accent">你</span>
          </h3>
          <p v-if="p.ratingAfter !== undefined" class="mt-1 text-xs text-soft">
            排位
            <span class="font-mono"
              >{{ p.ratingBefore?.toFixed(2) }} → {{ p.ratingAfter.toFixed(2) }}</span
            >
          </p>
        </div>
        <div v-if="match.status === 'completed'" class="flex shrink-0 items-center gap-3">
          <span class="font-mono text-lg"
            >{{ match.result?.players.find((player) => player.id === p.userId)?.score ?? "—" }}
            <span class="font-sans text-xs text-soft">分</span></span
          ><AppBadge v-if="p.rank">第 {{ p.rank }} 名</AppBadge>
        </div>
        <span v-else class="text-xs text-soft">席位 {{ p.slot + 1 }}</span>
      </section>
    </div>
    <details class="mt-4 border-t border-line pt-3 text-xs text-soft">
      <summary class="w-fit cursor-pointer py-1">
        比赛信息{{ match.result ? ` · ${match.result.completedTicks} tick` : "" }}
      </summary>
      <dl class="mt-2 flex flex-wrap gap-x-6 gap-y-2 font-mono">
        <div>
          <dt class="inline font-sans">ID</dt>
          <dd class="inline break-all">{{ match.id }}</dd>
        </div>
        <div>
          <dt class="inline font-sans">发行</dt>
          <dd class="inline">{{ match.release }}</dd>
        </div>
        <div>
          <dt class="inline font-sans">种子</dt>
          <dd class="inline">{{ match.seed }}</dd>
        </div>
        <div>
          <dt class="inline font-sans">更新时间</dt>
          <dd class="inline">
            <time :datetime="match.updatedAt">{{
              new Date(match.updatedAt).toLocaleString("zh-CN")
            }}</time>
          </dd>
        </div>
      </dl>
    </details>
  </section>
</template>
