<script setup lang="ts">
import type { MatchSummary } from "@si-arena/protocol";
import { RouterLink } from "vue-router";
import AppBadge from "./ui/AppBadge.vue";

defineProps<{ matches: MatchSummary[] }>();

const labels = {
  pending: "等待开局",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
} as const;

const tones = {
  pending: "warning",
  running: "accent",
  completed: "success",
  failed: "danger",
} as const;
</script>

<template>
  <ul v-if="matches.length" class="overflow-hidden rounded-card border border-line bg-surface">
    <li v-for="match in matches" :key="match.id" class="border-b border-line last:border-b-0">
      <RouterLink
        class="block px-4 py-3.5 transition hover:bg-subtle"
        :to="`/matches/${encodeURIComponent(match.id)}`"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <AppBadge :tone="tones[match.status]">{{ labels[match.status] }}</AppBadge>
          <time class="meta" :datetime="match.createdAt">{{
            new Date(match.createdAt).toLocaleString("zh-CN")
          }}</time>
        </div>
        <div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span v-for="p in match.participants" :key="p.userId" class="min-w-0 break-all">
            {{ p.username }}
            <span v-if="p.official" class="text-faint">· 官方</span>
            <span v-if="p.rank" class="font-mono text-xs text-faint">#{{ p.rank }}</span>
          </span>
        </div>
      </RouterLink>
    </li>
  </ul>
</template>
