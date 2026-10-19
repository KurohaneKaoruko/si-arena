<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { clampMatchPage } from "@si-arena/protocol";
import { parseGame, parseLeaderboard } from "../api/contracts";
import { useApiResource } from "../composables/useApiResource";
import PaginationControls from "../components/PaginationControls.vue";
import AppBadge from "../components/ui/AppBadge.vue";
import DataTable from "../components/ui/DataTable.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import StateBlock from "../components/ui/StateBlock.vue";

const route = useRoute();
const router = useRouter();
const gamePath = computed(() => `/games/${encodeURIComponent(String(route.params.gameId))}`);
const page = computed(() => clampMatchPage(Number(route.query.page ?? 1)));
const { data: game } = useApiResource(() => `/api${gamePath.value}`, parseGame);
const { data, status, empty, error, pending, reload } = useApiResource(
  () => `/api${gamePath.value}/leaderboard?page=${page.value}&limit=20`,
  parseLeaderboard,
  { isEmpty: (value) => value.players.length === 0 },
);
function change(value: number) {
  void router.push({ query: { page: value } });
}
</script>

<template>
  <div>
    <RouterLink
      :to="gamePath"
      class="inline-flex items-center gap-1 text-sm text-soft transition hover:text-ink"
      >← 返回游戏</RouterLink
    >
    <PageHeader
      class="mt-6"
      :title="`${game?.name ?? '游戏'} 排行榜`"
      description="按排位分排序，官方选手与玩家共用同一榜单。"
    />
    <div class="mt-8">
      <StateBlock v-if="status === 'loading'" status="loading" />
      <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
      <StateBlock v-else-if="empty" status="empty" message="还没有排名，成为第一位参赛者。" />
      <DataTable v-else caption="按排位分排序的选手列表">
        <template #head>
          <tr>
            <th class="data-head-cell w-14" scope="col">#</th>
            <th class="data-head-cell" scope="col">选手</th>
            <th class="data-head-cell" scope="col">排位分</th>
            <th class="data-head-cell hidden sm:table-cell" scope="col">场次</th>
            <th class="data-head-cell hidden sm:table-cell" scope="col">胜 / 平 / 负</th>
          </tr>
        </template>
        <tr v-for="p in data?.players ?? []" :key="p.userId" class="transition hover:bg-subtle">
          <td class="data-cell">
            <span
              v-if="p.rank <= 3"
              class="inline-flex size-6 items-center justify-center rounded-control bg-accent-soft font-mono text-xs font-semibold text-accent"
              >{{ p.rank }}</span
            >
            <span v-else class="font-mono text-xs text-faint">{{ p.rank }}</span>
          </td>
          <td class="data-cell max-w-52 break-all font-medium">
            {{ p.username }}
            <AppBadge v-if="p.official" class="ml-1.5 align-middle" tone="accent">官方</AppBadge>
          </td>
          <td class="data-cell font-mono tracking-tight">{{ p.rating.toFixed(2) }}</td>
          <td class="data-cell hidden font-mono text-soft sm:table-cell">
            {{ p.matchesPlayed }}
          </td>
          <td class="data-cell hidden whitespace-nowrap font-mono text-soft sm:table-cell">
            {{ p.wins }} / {{ p.draws }} / {{ p.losses }}
          </td>
        </tr>
      </DataTable>
      <PaginationControls
        v-if="data"
        :page="data.page"
        :limit="data.limit"
        :total="data.total"
        :pending="pending"
        @change="change"
      />
    </div>
  </div>
</template>
