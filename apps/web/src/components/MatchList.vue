<script setup lang="ts">
import type { MatchSummary } from "@si-arena/protocol";
import { RouterLink } from "vue-router";
defineProps<{ matches: MatchSummary[] }>();
const labels = {
  pending: "等待开局",
  running: "比赛进行中",
  completed: "已完成",
  failed: "比赛失败",
};
</script>
<template>
  <ul v-if="matches.length" class="space-y-3">
    <li v-for="match in matches" :key="match.id">
      <RouterLink
        class="panel block p-5 transition-colors hover:border-arena-accent/60"
        :to="`/matches/${encodeURIComponent(match.id)}`"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span
            class="text-sm"
            :class="match.status === 'completed' ? 'text-arena-accent' : 'text-arena-muted'"
            >{{ labels[match.status] }}</span
          ><time class="text-xs text-arena-muted" :datetime="match.createdAt">{{
            new Date(match.createdAt).toLocaleString("zh-CN")
          }}</time>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span v-for="p in match.participants" :key="p.userId" class="min-w-0 break-all"
            >{{ p.username
            }}<span v-if="p.official" class="ml-2 text-xs text-arena-accent">官方</span
            ><span v-if="p.rank" class="ml-2 font-mono text-xs text-arena-muted"
              >#{{ p.rank }}</span
            ></span
          >
        </div>
        <p class="mt-4 truncate font-mono text-xs text-arena-muted">
          {{ match.id }} <span class="text-arena-accent">→</span>
        </p>
      </RouterLink>
    </li>
  </ul>
  <p v-else class="panel p-7 text-arena-muted">还没有比赛。上传策略并主动发起第一场匹配。</p>
</template>
