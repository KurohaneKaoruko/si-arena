<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed, watch } from "vue";
import { parseMatch } from "../api/contracts";
import { useApiResource } from "../composables/useApiResource";
import { useMatchReplay } from "../composables/useMatchReplay";
import { gameMatchLocation } from "../games/locations";
import GameMatchSummary from "./GameMatchSummary.vue";
import GamePreview from "./GamePreview.vue";
import GameStageHeader from "./GameStageHeader.vue";
import ReplayLoadState from "./ReplayLoadState.vue";
import ReplayViewer from "./ReplayViewer.vue";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";

const props = defineProps<{
  game: GameCatalogEntry;
  matchId: string;
  detailsTarget: HTMLElement | null;
}>();
const emit = defineEmits<{ settled: [] }>();
const { data, status, error, refreshError, reload } = useApiResource(
  () => `/api/matches/${encodeURIComponent(props.matchId)}`,
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
const replay = useMatchReplay(() => data.value);
const failures = {
  ENTRY_CHANGED_BEFORE_START: "开局前选手代码或游戏接口发生变化，请检查代码后重新匹配。",
  WORKER_LOST: "本场执行中断，请重新发起匹配。",
  EXECUTION_FAILED: "本场未能完成，请重新发起匹配。",
} as const;
const statusText = { pending: "等待开局", running: "比赛进行中", failed: "比赛失败" } as const;
const title = computed(() => {
  const players = data.value?.participants.toSorted((a, b) => a.slot - b.slot) ?? [];
  if (players.length === 2) return `${players[0]!.username} 对 ${players[1]!.username}`;
  return players.length ? `${players.length} 人对局` : "比赛";
});
watch(
  () => data.value?.status,
  (value) => {
    if (value === "completed" || value === "failed") emit("settled");
  },
);
</script>

<template>
  <section class="game-stage" aria-label="当前查看的比赛">
    <GameStageHeader :game="game" :title="title">
      <AppButton
        v-if="data?.status === 'completed' && !replay.unsupported.value"
        :href="replay.path.value ?? undefined"
        download
      >
        <svg
          class="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        </svg>
        下载回放
      </AppButton>
      <AppButton variant="ghost" :to="gameMatchLocation(game.id)">收起比赛</AppButton>
    </GameStageHeader>
    <ReplayViewer
      v-if="replay.session.value && data"
      :key="replay.session.value.replay.matchId"
      :session="replay.session.value"
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
        <ReplayLoadState
          v-else-if="data?.status === 'completed'"
          :pending="replay.pending.value"
          :ticks="replay.ticks.value"
          :error="replay.error.value"
          :unsupported="replay.unsupported.value"
          @load="replay.load"
          @cancel="replay.cancel"
        />
        <p
          v-else-if="data"
          role="status"
          class="card flex items-center gap-2.5 px-4 py-3 text-sm text-ink"
        >
          <span
            class="size-2.5 rounded-full"
            :class="data.status === 'failed' ? 'bg-danger' : 'animate-pulse bg-warning'"
            aria-hidden="true"
          ></span>
          {{ statusText[data.status] }}
        </p>
      </div>
    </div>
    <Teleport :to="detailsTarget ?? 'body'" :disabled="!detailsTarget">
      <div
        v-if="refreshError"
        role="alert"
        class="rounded-panel border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-ink"
      >
        {{ refreshError }} <AppButton size="sm" @click="reload">重新加载</AppButton>
      </div>
      <template v-if="!replay.session.value">
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
          class="rounded-panel border border-danger-line bg-danger-soft p-4 text-sm text-danger-ink"
        >
          <p>
            {{ data.failureReason ? failures[data.failureReason] : "比赛未能完成，请重新匹配。" }}
          </p>
          <p class="mt-2 text-xs text-soft">本场不计分。</p>
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
