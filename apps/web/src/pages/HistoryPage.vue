<script setup lang="ts">
import { clampMatchPage } from "@si-arena/protocol";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { parseHistory } from "../api/contracts";
import { session } from "../auth/session";
import MatchList from "../components/MatchList.vue";
import PaginationControls from "../components/PaginationControls.vue";
import StateBlock from "../components/ui/StateBlock.vue";
import AppButton from "../components/ui/AppButton.vue";
import { useApiResource } from "../composables/useApiResource";
import type { GameCatalogEntry } from "@si-arena/protocol";

defineProps<{ game: GameCatalogEntry }>();

const route = useRoute();
const router = useRouter();
const gamePath = computed(() => `/games/${encodeURIComponent(String(route.params.gameId))}`);
const page = computed(() => clampMatchPage(Number(route.query.page ?? 1)));
const { data, status, empty, error, refreshError, pending, reload } = useApiResource(
  () => `/api${gamePath.value}/me/matches?page=${page.value}&limit=20`,
  parseHistory,
  // 以总数判断是否真的没有比赛：越界页码返回的会是空列表，但仍然有比赛。
  {
    authenticated: true,
    isEmpty: (value) => value.total === 0,
    pollWhen: (value) =>
      value.matches.some((match) => match.status === "pending" || match.status === "running"),
    notify: false,
  },
);
function change(value: number) {
  void router.push({ query: { ...route.query, page: value } });
}
defineExpose({ refresh: reload });
</script>

<template>
  <div>
    <h2 class="mb-3 text-[15px] font-semibold">我的比赛</h2>
    <p v-if="session.ready && !session.user" class="py-8 text-center text-sm text-soft">
      登录后查看比赛
    </p>
    <div v-else>
      <StateBlock v-if="status === 'loading'" status="loading" />
      <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
      <StateBlock v-else-if="empty" status="empty" message="暂无比赛" />
      <template v-else-if="data">
        <MatchList v-if="data.matches.length" :matches="data.matches" />
        <div
          v-else
          class="rounded-card border border-line bg-surface px-5 py-4 text-sm leading-6 text-soft"
        >
          本页没有比赛。
        </div>
        <PaginationControls
          :page="data.page"
          :limit="data.limit"
          :total="data.total"
          :pending="pending"
          @change="change"
        />
      </template>
      <p v-if="refreshError" role="alert" class="mt-3 text-sm text-danger">
        {{ refreshError }} <AppButton size="sm" variant="link" @click="reload">重新加载</AppButton>
      </p>
    </div>
  </div>
</template>
