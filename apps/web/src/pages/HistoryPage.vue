<script setup lang="ts">
import { clampMatchPage } from "@si-arena/protocol";
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { parseHistory } from "../api/contracts";
import AccountGate from "../components/AccountGate.vue";
import MatchList from "../components/MatchList.vue";
import PaginationControls from "../components/PaginationControls.vue";
import PageHeader from "../components/ui/PageHeader.vue";
import StateBlock from "../components/ui/StateBlock.vue";
import { useApiResource } from "../composables/useApiResource";

const route = useRoute();
const router = useRouter();
const gamePath = computed(() => `/games/${encodeURIComponent(String(route.params.gameId))}`);
const page = computed(() => clampMatchPage(Number(route.query.page ?? 1)));
const { data, status, empty, error, pending, reload } = useApiResource(
  () => `/api${gamePath.value}/me/matches?page=${page.value}&limit=20`,
  parseHistory,
  // 以总数判断是否真的没有比赛：越界页码返回的会是空列表，但仍然有比赛。
  { authenticated: true, isEmpty: (value) => value.total === 0 },
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
      title="我的比赛"
      description="你主动发起的比赛，以及其他玩家匹配到你的比赛。"
    />
    <div class="mt-8">
      <AccountGate>
        <StateBlock v-if="status === 'loading'" status="loading" />
        <StateBlock
          v-else-if="status === 'error'"
          status="error"
          :message="error"
          @retry="reload"
        />
        <StateBlock
          v-else-if="empty"
          status="empty"
          message="还没有比赛。上传策略并主动发起第一场匹配。"
        />
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
      </AccountGate>
    </div>
  </div>
</template>
