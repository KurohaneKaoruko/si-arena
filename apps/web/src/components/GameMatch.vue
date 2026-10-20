<script setup lang="ts">
import {
  loadRegisteredReplay,
  readBrowserReplay,
  type BrowserReplaySession,
} from "@si-arena/player/browser";
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { errorMessage } from "../api/client";
import { parseMatch } from "../api/contracts";
import { downloadReplay } from "../api/replay";
import { useApiResource } from "../composables/useApiResource";
import GamePreview from "./GamePreview.vue";
import ReplayViewer from "./ReplayViewer.vue";
import { replayGames } from "../games/replays";
import GameMatchSummary from "./GameMatchSummary.vue";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";
import { gameMatchLocation } from "../games/locations";

const props = defineProps<{
  game: GameCatalogEntry;
  matchId: string;
  detailsTarget: HTMLElement | null;
}>();
const emit = defineEmits<{ settled: [] }>();
const id = computed(() => props.matchId);
const { data, status, error, refreshError, reload } = useApiResource(
  () => `/api/matches/${encodeURIComponent(id.value)}`,
  (raw) => {
    const match = parseMatch(raw);
    if (match.gameId !== props.game.id || match.id !== props.matchId)
      throw new Error("比赛与当前游戏不匹配。");
    return match;
  },
  {
    pollWhen: (match) => match.status === "pending" || match.status === "running",
    notify: false,
  },
);
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
  () => `${data.value?.id}:${data.value?.status}`,
  () => {
    cancel();
    replay.value = null;
    replayError.value = "";
    if (data.value?.status === "completed") void loadReplay();
    if (data.value?.status === "completed" || data.value?.status === "failed") emit("settled");
  },
);
onUnmounted(cancel);
</script>

<template>
  <section class="game-match" aria-label="当前查看的比赛">
    <header class="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium">{{ data?.status === "completed" ? "比赛回放" : "比赛" }}</h2>
      <div class="flex flex-wrap items-center gap-2">
        <AppButton v-if="data?.status === 'completed'" size="sm" :href="replayPath" download
          >下载回放</AppButton
        >
        <AppButton variant="ghost" size="sm" :to="gameMatchLocation(game.id)">收起比赛</AppButton>
      </div>
    </header>
    <ReplayViewer
      v-if="replay && data"
      :key="replay.replay.matchId"
      :session="replay"
      :file-name="`${data.id}.json.gz`"
      source-kind="online"
      :details-target="detailsTarget"
      fit
    >
      <template #summary><GameMatchSummary :match="data" /></template>
    </ReplayViewer>
    <div v-else class="game-match-pending">
      <GamePreview :game="game" />
      <div class="game-match-overlay">
        <StateBlock v-if="status === 'loading'" status="loading" message="正在读取比赛…" />
        <StateBlock
          v-else-if="status === 'error'"
          status="error"
          :message="error"
          @retry="reload"
        />
        <template v-else-if="data?.status === 'completed'">
          <StateBlock
            v-if="replayPending"
            status="loading"
            :message="ticks ? `已检查 ${ticks} tick…` : '正在下载并校验回放…'"
          >
            <template #action><AppButton size="sm" @click="cancel">取消加载</AppButton></template>
          </StateBlock>
          <StateBlock
            v-else-if="replayError"
            status="error"
            :message="replayError"
            @retry="loadReplay"
          />
          <StateBlock v-else status="empty" message="回放加载已取消。"
            ><template #action
              ><AppButton @click="loadReplay">加载回放</AppButton></template
            ></StateBlock
          >
        </template>
        <p
          v-else
          role="status"
          class="rounded-card border border-line bg-surface px-4 py-3 text-sm text-soft"
        >
          {{
            data?.status === "pending"
              ? "等待开局"
              : data?.status === "running"
                ? "比赛进行中"
                : "比赛失败"
          }}
        </p>
      </div>
    </div>
    <Teleport :to="detailsTarget ?? 'body'" :disabled="!detailsTarget">
      <div
        v-if="refreshError"
        role="alert"
        class="rounded-card border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger"
      >
        {{ refreshError }} <AppButton size="sm" @click="reload">重新加载</AppButton>
      </div>
      <template v-if="!replay">
        <GameMatchSummary v-if="data" :match="data" />
        <p
          v-if="data?.status === 'pending' || data?.status === 'running'"
          role="status"
          class="text-sm text-soft"
        >
          {{
            data.status === "pending"
              ? "双方已就位，等待开局。"
              : "策略执行中，完成后自动显示结果与回放。"
          }}
        </p>
        <div
          v-else-if="data?.status === 'failed'"
          role="alert"
          class="rounded-card border border-danger/25 p-4 text-sm text-danger"
        >
          <p>
            {{ data.failureReason ? failures[data.failureReason] : "比赛未能完成，请重新匹配。" }}
          </p>
          <p class="mt-2 text-xs text-soft">本场不计排位分。</p>
        </div>
        <StateBlock
          v-else-if="status === 'error'"
          status="error"
          :message="error"
          @retry="reload"
        />
      </template>
    </Teleport>
  </section>
</template>
