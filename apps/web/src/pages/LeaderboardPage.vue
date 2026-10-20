<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { clampMatchPage } from "@si-arena/protocol";
import { parseLeaderboard } from "../api/contracts";
import { session } from "../auth/session";
import { useApiResource } from "../composables/useApiResource";
import PaginationControls from "../components/PaginationControls.vue";
import AppBadge from "../components/ui/AppBadge.vue";
import DataTable from "../components/ui/DataTable.vue";
import StateBlock from "../components/ui/StateBlock.vue";
import type { GameCatalogEntry } from "@si-arena/protocol";

defineProps<{ game: GameCatalogEntry }>();

const route = useRoute();
const router = useRouter();
const gamePath = computed(() => `/games/${encodeURIComponent(String(route.params.gameId))}`);
const page = computed(() => clampMatchPage(Number(route.query.page ?? 1)));
const { data, status, empty, error, pending, reload } = useApiResource(
  () => `/api${gamePath.value}/leaderboard?page=${page.value}&limit=20`,
  parseLeaderboard,
  { isEmpty: (value) => value.players.length === 0 },
);
function change(value: number) {
  void router.push({ query: { ...route.query, page: value } });
}
defineExpose({ refresh: reload });
</script>

<template>
  <div>
    <h2 class="mb-3 text-[15px] font-semibold">排行榜</h2>
    <div>
      <StateBlock v-if="status === 'loading'" status="loading" />
      <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
      <StateBlock v-else-if="empty" status="empty" message="还没有排名，成为第一位参赛者。" />
      <DataTable v-else caption="按排位分排序的选手列表">
        <template #head>
          <tr>
            <th class="data-head-cell w-14" scope="col">#</th>
            <th class="data-head-cell" scope="col">选手</th>
            <th class="data-head-cell" scope="col">排位分</th>
          </tr>
        </template>
        <tr
          v-for="p in data?.players ?? []"
          :key="p.userId"
          class="transition hover:bg-subtle"
          :class="p.userId === session.user?.id ? 'bg-accent-soft' : ''"
        >
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
            <span v-if="p.userId === session.user?.id" class="ml-1 text-xs text-accent">你</span>
            <AppBadge v-if="p.official" class="ml-1.5 align-middle" tone="accent">官方</AppBadge>
            <p class="mt-1 text-xs font-normal text-soft">
              {{ p.matchesPlayed }} 场 · {{ p.wins }} 胜 {{ p.draws }} 平 {{ p.losses }} 负
            </p>
          </td>
          <td class="data-cell font-mono tracking-tight">{{ p.rating.toFixed(2) }}</td>
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
