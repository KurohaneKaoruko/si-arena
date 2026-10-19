<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { clampMatchPage } from "@si-arena/protocol";
import { parseGame, parseLeaderboard } from "../api/contracts";
import { useApiResource } from "../composables/useApiResource";
import PaginationControls from "../components/PaginationControls.vue";
const route = useRoute();
const router = useRouter();
const gamePath = computed(() => `/games/${encodeURIComponent(String(route.params.gameId))}`);
const page = computed(() => clampMatchPage(Number(route.query.page ?? 1)));
const { data: game } = useApiResource(() => `/api${gamePath.value}`, parseGame);
const { data, pending, error, reload } = useApiResource(
  () => `/api${gamePath.value}/leaderboard?page=${page.value}&limit=20`,
  parseLeaderboard,
);
function change(value: number) {
  void router.push({ query: { page: value } });
}
</script>
<template>
  <RouterLink class="mb-8 inline-flex min-h-11 items-center text-sm text-arena-muted" :to="gamePath"
    >← 返回游戏</RouterLink
  >
  <p class="eyebrow">LEADERBOARD</p>
  <h1 class="mt-4 text-3xl font-semibold">{{ game?.name }} 排行榜</h1>
  <p class="mt-4 leading-7 text-arena-muted">每个游戏独立计分，官方选手也在同一赛场竞争。</p>
  <div class="mt-8" :aria-busy="pending">
    <p v-if="pending && !data" role="status" class="panel p-7 text-arena-muted">正在加载排行榜…</p>
    <div v-if="error" role="alert" class="panel p-7">
      <p class="text-arena-danger">{{ error }}</p>
      <button class="button-secondary mt-4" @click="reload">重新加载</button>
    </div>
    <div v-if="data?.players.length" class="panel overflow-x-auto">
      <table class="w-full text-left text-sm">
        <caption class="sr-only">
          按排位分排序的选手列表
        </caption>
        <thead class="border-b border-arena-border text-arena-muted">
          <tr>
            <th class="p-4 font-medium" scope="col">排名</th>
            <th class="p-4 font-medium" scope="col">选手</th>
            <th class="p-4 font-medium" scope="col">排位分</th>
            <th class="p-4 font-medium" scope="col">场次</th>
            <th class="hidden p-4 font-medium sm:table-cell" scope="col">胜 / 平 / 负</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-arena-border">
          <tr v-for="p in data.players" :key="p.userId">
            <td class="p-4 font-mono text-arena-muted">{{ p.rank }}</td>
            <td class="max-w-52 break-all p-4">
              {{ p.username
              }}<span v-if="p.official" class="ml-2 text-xs text-arena-accent">官方</span>
            </td>
            <td class="p-4 font-mono text-arena-accent">{{ p.rating.toFixed(1) }}</td>
            <td class="p-4 font-mono">{{ p.matchesPlayed }}</td>
            <td class="hidden whitespace-nowrap p-4 font-mono text-arena-muted sm:table-cell">
              {{ p.wins }} / {{ p.draws }} / {{ p.losses }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="data" class="panel p-7 text-arena-muted">暂无排名，成为第一位参赛者。</p>
    <PaginationControls
      v-if="data"
      :page="data.page"
      :limit="data.limit"
      :total="data.total"
      :pending="pending"
      @change="change"
    />
  </div>
</template>
