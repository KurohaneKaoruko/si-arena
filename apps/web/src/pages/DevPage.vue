<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { loadRegisteredReplay, type BrowserReplaySession } from "@si-arena/player/browser";
import { replayGames } from "../games/replays";
import ReplayViewer from "../components/ReplayViewer.vue";
import AppBadge from "../components/ui/AppBadge.vue";
import AppButton from "../components/ui/AppButton.vue";
import PageHeader from "../components/ui/PageHeader.vue";

interface DevResultPlayer {
  id: string;
  rank: number;
  score: number;
}
interface DevStatus {
  game: { id: string; name: string; release: string; botProtocolVersion: number };
  current: {
    phase: "running" | "completed" | "error";
    run: number;
    seed: number;
    completedTicks: number;
    maxTicks: number;
    players: Array<{ id: string; name: string; official: boolean }>;
    result?: { reason: string; completedTicks: number; players: DevResultPlayer[] };
    message?: string;
  };
  lastCompleted: {
    run: number;
    matchId: string;
    seed: number;
    result: { reason: string; completedTicks: number; players: DevResultPlayer[] };
    finalStateHash: string;
  } | null;
  memoryTruncated: boolean;
}

const status = shallowRef<DevStatus | null>(null);
const session = shallowRef<BrowserReplaySession | null>(null);
const sessionError = ref("");
const restarting = ref(false);
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let loadedRun = 0;
let disposed = false;

const phase = computed(() => status.value?.current.phase);
const current = computed(() => status.value?.current);
const players = computed(() => current.value?.players ?? []);
const ranking = computed(() => {
  const result = current.value?.result ?? status.value?.lastCompleted?.result;
  if (!result) return [];
  return [...result.players]
    .toSorted((a, b) => a.rank - b.rank)
    .map((entry) => ({
      ...entry,
      name: players.value.find((player) => player.id === entry.id)?.name ?? entry.id,
    }));
});
const progressPercent = computed(() => {
  const value = current.value;
  if (!value || !value.maxTicks) return 0;
  return Math.min(100, Math.round((value.completedTicks / value.maxTicks) * 100));
});
const phaseBadge = {
  running: "accent",
  completed: "success",
  error: "danger",
} as const;

function schedule(delay: number): void {
  if (disposed) return;
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void poll(), delay);
}

async function poll(): Promise<void> {
  try {
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (disposed) return;
    status.value = (await response.json()) as DevStatus;
    if (status.value.current.phase === "running") {
      schedule(500);
      return;
    }
    const completedRun = status.value.lastCompleted?.run;
    if (completedRun && completedRun !== loadedRun) await loadReplay(completedRun);
  } catch {
    schedule(2000);
  }
}

async function loadReplay(run: number): Promise<void> {
  loadedRun = run;
  session.value = null;
  sessionError.value = "";
  memoryCache.clear();
  memoryGeneration++;
  try {
    const response = await fetch("/api/session/replay");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    session.value = await loadRegisteredReplay(raw, replayGames, {
      yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
    });
  } catch (cause) {
    sessionError.value = `无法加载本场回放：${cause instanceof Error ? cause.message : "读取失败"}`;
  }
}

async function restart(seed?: number): Promise<void> {
  if (restarting.value) return;
  restarting.value = true;
  try {
    const response = await fetch("/api/session/restart", {
      method: "POST",
      ...(seed === undefined ? {} : { body: JSON.stringify({ seed }) }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    void poll();
  } catch {
    schedule(500);
  } finally {
    restarting.value = false;
  }
}

function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0]!;
}

const memoryCache = new Map<
  number,
  { players: Record<string, { before: unknown; after: unknown }> }
>();
let memoryGeneration = 0;
async function memory(
  tick: number,
  playerId: string,
): Promise<{ before: unknown; after: unknown } | undefined> {
  if (!memoryCache.has(tick)) {
    const generation = memoryGeneration;
    const response = await fetch(`/api/session/memory?tick=${tick}`);
    if (!response.ok) return undefined;
    const snapshot = await response.json();
    // A newer run may have been loaded while the fetch was in flight.
    if (generation !== memoryGeneration) return undefined;
    memoryCache.set(tick, snapshot);
  }
  return memoryCache.get(tick)!.players[playerId];
}

onMounted(() => void poll());
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(pollTimer);
});
</script>

<template>
  <section>
    <PageHeader
      title="实时调试"
      description="每局都在本地运行，整场完成后可逐步查看动作、日志、错误与 Memory 提交。改代码后重新开局，不会热替换进行中的比赛。"
    >
      <template #actions>
        <AppButton variant="secondary" :loading="restarting" @click="restart()">
          重新开局（同种子）
        </AppButton>
        <AppButton variant="primary" :loading="restarting" @click="restart(randomSeed())">
          换种子重开
        </AppButton>
      </template>
    </PageHeader>

    <div class="mt-8 rounded-card border border-line bg-surface p-5 shadow-card" aria-live="polite">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="break-all font-mono text-xs text-faint">
            {{
              status
                ? `${status.game.name} · ${status.game.release} · 第 ${status.current.run} 局 · 种子 ${status.current.seed}`
                : "正在连接本地调试服务…"
            }}
          </p>
          <h2 class="mt-1.5 text-[15px] font-semibold tracking-tight">
            {{
              phase === "running"
                ? "比赛进行中，完成后自动载入播放器。"
                : phase === "completed"
                  ? "本局已完成"
                  : phase === "error"
                    ? "本局启动失败"
                    : "等待本地调试服务…"
            }}
          </h2>
        </div>
        <AppBadge v-if="phase" :tone="phaseBadge[phase]">
          {{ phase === "running" ? "RUNNING" : phase === "completed" ? "COMPLETED" : "ERROR" }}
        </AppBadge>
      </div>

      <div v-if="phase === 'running' && current" class="mt-4">
        <p class="font-mono text-sm text-soft" data-testid="dev-progress">
          已完成 {{ current.completedTicks }} / {{ current.maxTicks }} tick
        </p>
        <div
          class="mt-2 h-1.5 w-full overflow-hidden rounded-control bg-muted"
          role="progressbar"
          aria-label="比赛进度"
          :aria-valuenow="current.completedTicks"
          aria-valuemin="0"
          :aria-valuemax="current.maxTicks"
        >
          <div
            class="h-full rounded-control bg-accent transition-[width] duration-500"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
      </div>

      <p
        v-if="phase === 'error' && current?.message"
        role="alert"
        class="mt-4 break-words rounded-control border border-danger/25 bg-danger-soft p-3 text-sm text-danger"
      >
        {{ current.message }}
      </p>
      <p v-if="phase === 'error' && status?.lastCompleted" class="mt-2 text-xs text-soft">
        下方仍显示第 {{ status.lastCompleted.run }} 局的结果，修复代码后可重新开局。
      </p>

      <div v-if="ranking.length" class="mt-4 border-t border-line pt-3.5">
        <h3 class="text-sm font-semibold">
          {{ phase === "completed" ? "本局排名" : `第 ${status?.lastCompleted?.run} 局排名` }}
        </h3>
        <p v-for="entry in ranking" :key="entry.id" class="mt-1.5 text-sm text-soft">
          第 {{ entry.rank }} 名 · {{ entry.name }} · {{ entry.score }} 分
        </p>
      </div>

      <div v-if="players.length" class="mt-4 flex flex-wrap gap-2 border-t border-line pt-3.5">
        <AppBadge v-for="player in players" :key="player.id">
          {{ player.name }}{{ player.official ? " · 官方" : "" }}
        </AppBadge>
      </div>

      <p v-if="status?.memoryTruncated" class="mt-4 text-xs text-warning">
        本地会话的 Memory 记录已达上限，之后的 tick 不再记录新的提交，对比可能停留在旧值。
      </p>
    </div>

    <p
      v-if="sessionError"
      role="alert"
      class="mt-8 break-words rounded-card border border-danger/25 bg-danger-soft p-5 text-sm text-danger"
    >
      {{ sessionError }}
    </p>

    <ReplayViewer
      v-if="session"
      :key="session.replay.matchId"
      class="mt-8"
      :session="session"
      file-name="本地调试会话"
      :memory="memory"
      source-kind="live"
    />
  </section>
</template>
