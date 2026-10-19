<script setup lang="ts">
import { clampMatchPage } from "@si-arena/protocol";
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { parseHistory } from "../api/contracts";
import AccountGate from "../components/AccountGate.vue";
import MatchList from "../components/MatchList.vue";
import PaginationControls from "../components/PaginationControls.vue";
import { useApiResource } from "../composables/useApiResource";
const route = useRoute();
const router = useRouter();
const gamePath = computed(() => `/games/${encodeURIComponent(String(route.params.gameId))}`);
const page = computed(() => clampMatchPage(Number(route.query.page ?? 1)));
const { data, pending, error, reload } = useApiResource(
  () => `/api${gamePath.value}/me/matches?page=${page.value}&limit=20`,
  parseHistory,
  { authenticated: true },
);
function change(value: number) {
  void router.push({ query: { page: value } });
}
</script>
<template>
  <RouterLink class="mb-8 inline-flex min-h-11 items-center text-sm text-arena-muted" :to="gamePath"
    >← 返回游戏</RouterLink
  >
  <p class="eyebrow">MATCH HISTORY</p>
  <h1 class="mt-4 text-3xl font-semibold">我的比赛</h1>
  <p class="mt-4 leading-7 text-arena-muted">包括你主动发起的比赛，以及其他玩家匹配到你的比赛。</p>
  <div class="mt-8">
    <AccountGate>
      <p v-if="pending && !data" role="status" class="panel p-7 text-arena-muted">正在加载战绩…</p>
      <div v-if="error" role="alert" class="panel p-7">
        <p class="text-arena-danger">{{ error }}</p>
        <button class="button-secondary mt-4" @click="reload">重新加载</button>
      </div>
      <MatchList v-if="data" :matches="data.matches" />
      <PaginationControls
        v-if="data"
        :page="data.page"
        :limit="data.limit"
        :total="data.total"
        :pending="pending"
        @change="change"
      />
    </AccountGate>
  </div>
</template>
