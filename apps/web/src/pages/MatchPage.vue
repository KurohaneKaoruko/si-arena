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
import AppBadge from "../components/ui/AppBadge.vue";
import AppButton from "../components/ui/AppButton.vue";
import StateBlock from "../components/ui/StateBlock.vue";

const route = useRoute();
const id = computed(() => String(route.params.matchId));
const { data, status, error, reload } = useApiResource(
  () => `/api/matches/${encodeURIComponent(id.value)}`,
  parseMatch,
  {
    pollWhen: (match) => match.status === "pending" || match.status === "running",
    notify: false,
  },
);
const labels = {
  pending: "等待开局",
  running: "比赛进行中",
  completed: "比赛结束",
  failed: "比赛失败",
} as const;
const tones = {
  pending: "warning",
  running: "accent",
  completed: "success",
  failed: "danger",
} as const;
const failures = {
  ENTRY_CHANGED_BEFORE_START: "开局前选手代码或游戏接口发生变化，请检查代码后重新匹配。",
  WORKER_LOST: "本场执行中断，请重新发起匹配。",
  EXECUTION_FAILED: "本场未能完成，请重新发起匹配。",
} as const;
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
  <div>
    <RouterLink
      :to="data ? `/games/${encodeURIComponent(data.gameId)}` : '/'"
      class="inline-flex items-center gap-1 text-sm text-soft transition hover:text-ink"
      >← 返回赛场</RouterLink
    >
    <div class="mt-6 flex flex-wrap items-center gap-3">
      <h1 class="text-[26px] leading-tight font-semibold tracking-tight sm:text-[32px]">
        {{ data ? labels[data.status] : "比赛详情" }}
      </h1>
      <AppBadge v-if="data" :tone="tones[data.status]">{{ labels[data.status] }}</AppBadge>
    </div>
    <p class="mt-2 break-all font-mono text-xs text-faint">{{ id }}</p>

    <div class="mt-8">
      <StateBlock v-if="status === 'loading'" status="loading" />
      <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
    </div>

    <template v-if="data">
      <div
        v-if="data.status === 'pending' || data.status === 'running'"
        role="status"
        class="rounded-card border border-line bg-surface p-5"
      >
        <span class="inline-flex items-center gap-3 text-sm">
          <span
            class="inline-block size-2 rounded-full"
            :class="data.status === 'pending' ? 'bg-warning' : 'bg-accent'"
            aria-hidden="true"
          />
          {{
            data.status === "pending"
              ? "双方选手已就位，等待开局。"
              : "双方策略正在执行，完成后自动显示结果与回放。"
          }}
        </span>
        <p class="mt-2 text-sm text-soft">可以离开此页，稍后从「我的比赛」查看结果。</p>
      </div>

      <div
        v-if="data.status === 'failed'"
        role="alert"
        class="rounded-card border border-danger/25 p-5"
      >
        <p class="text-sm leading-6 text-danger">
          {{ data.failureReason ? failures[data.failureReason] : "本场比赛未能完成，请重新匹配。" }}
        </p>
        <p class="mt-2 text-sm text-soft">本场不计排位分。</p>
        <AppButton
          class="mt-4"
          variant="primary"
          :to="`/games/${encodeURIComponent(data.gameId)}#participate`"
          >返回参赛</AppButton
        >
      </div>

      <div class="mt-6 grid gap-3 sm:grid-cols-2">
        <div
          v-for="p in data.participants"
          :key="p.userId"
          class="min-w-0 rounded-card border border-line bg-surface p-5"
        >
          <div class="flex items-start justify-between gap-4">
            <h2 class="min-w-0 break-all text-[15px] font-semibold tracking-tight">
              {{ p.username }}
              <AppBadge v-if="p.official" class="ml-1 align-middle" tone="accent">官方</AppBadge>
            </h2>
            <span
              v-if="p.rank"
              class="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent"
              >#{{ p.rank }}</span
            >
          </div>
          <template v-if="data.status === 'completed'">
            <p class="mt-3 font-mono text-2xl tracking-tight">
              {{ data.result?.players.find((player) => player.id === p.userId)?.score ?? "—" }}
              <span class="font-sans text-xs font-normal text-faint">得分</span>
            </p>
            <p v-if="p.ratingAfter !== undefined" class="mt-3 text-sm text-soft">
              排位分
              <span class="font-mono text-ink"
                >{{ p.ratingBefore?.toFixed(2) }} → {{ p.ratingAfter.toFixed(2) }}</span
              >
              <span
                class="ml-1.5 font-mono"
                :class="
                  p.ratingAfter < (p.ratingBefore ?? p.ratingAfter) ? 'text-danger' : 'text-success'
                "
                >{{ delta(p.ratingBefore, p.ratingAfter) }}</span
              >
            </p>
          </template>
          <p v-else class="mt-3 text-sm text-soft">席位 {{ p.slot + 1 }}</p>
        </div>
      </div>

      <p v-if="data.result" class="mt-4 text-sm text-soft">
        共 {{ data.result.completedTicks }} tick ·
        <time :datetime="data.updatedAt">{{
          new Date(data.updatedAt).toLocaleString("zh-CN")
        }}</time>
      </p>

      <section
        v-if="data.status === 'completed'"
        class="mt-10"
        aria-labelledby="online-replay-title"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="online-replay-title" class="text-[15px] font-semibold tracking-tight">
            比赛回放
          </h2>
          <AppButton variant="secondary" size="sm" :href="replayPath" download>下载回放</AppButton>
        </div>
        <div v-if="replayPending" class="mt-4">
          <StateBlock
            status="loading"
            :message="ticks ? `已检查 ${ticks} tick…` : '正在下载并校验回放…'"
          />
        </div>
        <div v-else-if="!replay" class="mt-4">
          <StateBlock
            v-if="replayError"
            status="error"
            :message="replayError"
            action-label="重新加载"
            @retry="loadReplay"
          />
          <StateBlock v-else status="empty" message="回放加载已取消。" action-label="加载回放">
            <template #action>
              <AppButton variant="secondary" @click="loadReplay">加载回放</AppButton>
            </template>
          </StateBlock>
        </div>
        <ReplayViewer
          v-if="replay"
          :key="replay.replay.matchId"
          class="mt-4"
          :session="replay"
          :file-name="`${data.id}.json.gz`"
        />
      </section>
    </template>
  </div>
</template>
