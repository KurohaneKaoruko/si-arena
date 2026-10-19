<script setup lang="ts">
import {
  loadRegisteredReplay,
  readBrowserReplay,
  type BrowserReplaySession,
} from "@si-arena/player/browser";
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { errorMessage } from "../api/client";
import { parseMatch } from "../api/contracts";
import { downloadReplay } from "../api/replay";
import { useApiResource } from "../composables/useApiResource";
import ReplayViewer from "../components/ReplayViewer.vue";
import { replayGames } from "../games/replays";

const route = useRoute();
const id = computed(() => String(route.params.matchId));
const { data, pending, error, reload } = useApiResource(
  () => `/api/matches/${encodeURIComponent(id.value)}`,
  parseMatch,
  { pollWhen: (match) => match.status === "pending" || match.status === "running" },
);
const labels = {
  pending: "等待开局",
  running: "比赛进行中",
  completed: "比赛结束",
  failed: "比赛失败",
};
const failures = {
  ENTRY_CHANGED_BEFORE_START: "开局前选手代码或游戏接口发生变化，请检查代码后重新匹配。",
  WORKER_LOST: "本场执行中断，请重新发起匹配。",
  EXECUTION_FAILED: "本场未能完成，请重新发起匹配。",
};
const replay = shallowRef<BrowserReplaySession | null>(null);
const replayError = ref("");
const replayPending = ref(false);
const ticks = ref(0);
const replayPath = computed(() => `/api/matches/${encodeURIComponent(id.value)}/replay`);
let current: AbortController | undefined;
function cancel() {
  current?.abort();
  replayPending.value = false;
}
async function loadReplay() {
  cancel();
  const match = data.value;
  if (!match || match.status !== "completed") return;
  const request = new AbortController();
  current = request;
  replay.value = null;
  replayError.value = "";
  replayPending.value = true;
  ticks.value = 0;
  try {
    const file = await downloadReplay(replayPath.value, request.signal);
    const raw = await readBrowserReplay(file, request.signal);
    const loaded = await loadRegisteredReplay(raw, replayGames, {
      signal: request.signal,
      onProgress: (value) => {
        if (!request.signal.aborted) ticks.value = value;
      },
      yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
    });
    if (
      loaded.replay.matchId !== match.id ||
      loaded.replay.game.id !== match.gameId ||
      loaded.replay.game.release !== match.release
    )
      throw new Error("回放与当前比赛不匹配");
    if (!request.signal.aborted) replay.value = loaded;
  } catch (failure) {
    if (!request.signal.aborted) replayError.value = errorMessage(failure);
  } finally {
    if (current === request) replayPending.value = false;
  }
}
watch(
  () => [data.value?.id, data.value?.status],
  () => {
    cancel();
    replay.value = null;
    replayError.value = "";
    if (data.value?.status === "completed") void loadReplay();
  },
);
onUnmounted(cancel);
function delta(before?: number, after?: number) {
  if (before === undefined || after === undefined) return "";
  const value = after - before;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
</script>
<template>
  <RouterLink
    class="mb-8 inline-flex min-h-11 items-center text-sm text-arena-muted"
    :to="data ? `/games/${encodeURIComponent(data.gameId)}` : '/'"
    >← 返回赛场</RouterLink
  >
  <p class="eyebrow">MATCH ROOM</p>
  <h1 class="mt-4 text-3xl font-semibold">{{ data ? labels[data.status] : "比赛详情" }}</h1>
  <p class="mt-3 break-all font-mono text-xs leading-6 text-arena-muted">{{ id }}</p>
  <p v-if="pending && !data" role="status" class="panel mt-8 p-7 text-arena-muted">正在加载比赛…</p>
  <div v-if="error" role="alert" class="panel mt-8 p-7">
    <p class="text-arena-danger">{{ error }}</p>
    <button class="button-secondary mt-4" @click="reload">重新加载</button>
  </div>
  <template v-if="data">
    <div
      v-if="data.status === 'pending' || data.status === 'running'"
      role="status"
      class="panel mt-8 p-7"
    >
      <span class="mr-3 inline-block size-2 rounded-full bg-arena-accent" aria-hidden="true" />{{
        data.status === "pending"
          ? "双方选手已就位，等待开局。"
          : "双方策略正在执行，完成后将自动显示结果与回放。"
      }}
      <p class="mt-3 text-sm text-arena-muted">可以离开此页，稍后从「我的比赛」查看结果。</p>
    </div>
    <div v-if="data.status === 'failed'" role="alert" class="panel mt-8 p-7">
      <p class="text-arena-danger">
        {{ data.failureReason ? failures[data.failureReason] : "本场比赛未能完成，请重新匹配。" }}
      </p>
      <p class="mt-3 text-sm text-arena-muted">本场不计排位分。</p>
      <RouterLink
        class="button-primary mt-5"
        :to="`/games/${encodeURIComponent(data.gameId)}#participate`"
        >返回参赛</RouterLink
      >
    </div>
    <div class="mt-8 grid gap-4 sm:grid-cols-2">
      <div v-for="p in data.participants" :key="p.userId" class="panel min-w-0 p-6">
        <div class="flex items-start justify-between gap-4">
          <h2 class="min-w-0 break-all text-lg font-semibold">
            {{ p.username
            }}<span v-if="p.official" class="ml-2 text-xs text-arena-accent">官方</span>
          </h2>
          <span v-if="p.rank" class="font-mono text-xl text-arena-accent">#{{ p.rank }}</span>
        </div>
        <template v-if="data.status === 'completed'"
          ><p class="mt-4 font-mono text-3xl">
            {{ data.result?.players.find((player) => player.id === p.userId)?.score ?? "—"
            }}<span class="ml-2 font-sans text-sm text-arena-muted">得分</span>
          </p>
          <p v-if="p.ratingAfter !== undefined" class="mt-4 text-sm text-arena-muted">
            排位分
            <span class="font-mono text-arena-text"
              >{{ p.ratingBefore?.toFixed(2) }} → {{ p.ratingAfter.toFixed(2) }}</span
            ><span
              class="ml-2 font-mono"
              :class="
                p.ratingAfter < (p.ratingBefore ?? p.ratingAfter)
                  ? 'text-arena-danger'
                  : 'text-arena-accent'
              "
              >{{ delta(p.ratingBefore, p.ratingAfter) }}</span
            >
          </p></template
        >
        <p v-else class="mt-4 text-sm text-arena-muted">席位 {{ p.slot + 1 }}</p>
      </div>
    </div>
    <p v-if="data.result" class="mt-5 text-sm text-arena-muted">
      共 {{ data.result.completedTicks }} tick ·
      <time :datetime="data.updatedAt">{{ new Date(data.updatedAt).toLocaleString("zh-CN") }}</time>
    </p>
    <section v-if="data.status === 'completed'" class="mt-12" aria-labelledby="online-replay-title">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <h2 id="online-replay-title" class="text-xl font-semibold">比赛回放</h2>
        <a class="button-secondary" :href="replayPath" download>下载回放</a>
      </div>
      <div
        v-if="replayPending"
        class="panel mt-6 flex flex-wrap items-center justify-between gap-4 p-6"
      >
        <p role="status" class="text-arena-muted">
          {{ ticks ? `已检查 ${ticks} tick…` : "正在下载并校验回放…" }}
        </p>
        <button class="button-secondary" @click="cancel">取消加载</button>
      </div>
      <div v-else-if="!replay" class="panel mt-6 p-6">
        <p v-if="replayError" role="alert" class="text-arena-danger">{{ replayError }}</p>
        <p v-else class="text-arena-muted">回放加载已取消。</p>
        <button class="button-secondary mt-4" @click="loadReplay">加载回放</button>
      </div>
      <ReplayViewer
        v-if="replay"
        :key="replay.replay.matchId"
        class="mt-6"
        :session="replay"
        :file-name="`${data.id}.json.gz`"
      />
    </section>
  </template>
</template>
