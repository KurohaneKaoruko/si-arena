<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { loadRegisteredReplay, type BrowserReplaySession } from "@si-arena/player/browser";
import { replayGames } from "../games/replays";
import ReplayViewer from "../components/ReplayViewer.vue";

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
  <section aria-labelledby="dev-title">
    <div class="flex flex-wrap items-end justify-between gap-6">
      <div class="min-w-0">
        <p class="mb-3 font-mono text-xs tracking-[0.2em] text-arena-accent">
          LOCAL DEV / 实时调试
        </p>
        <h1 id="dev-title" class="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          改代码，开局，看细节。
        </h1>
        <p class="mt-4 max-w-2xl leading-7 text-arena-muted">
          每局都在本地运行，整场完成后可逐步查看动作、日志、错误与 Memory
          提交。修改代码后重新开局，不会热替换进行中的比赛。
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-3">
        <button type="button" class="button-secondary" :disabled="restarting" @click="restart()">
          重新开局（同种子）
        </button>
        <button
          type="button"
          class="button-primary"
          :disabled="restarting"
          @click="restart(randomSeed())"
        >
          换种子重开
        </button>
      </div>
    </div>

    <div class="panel mt-8 p-6" aria-live="polite">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="break-all font-mono text-xs text-arena-muted">
            {{
              status
                ? `${status.game.name} · ${status.game.release} · 第 ${status.current.run} 局 · 种子 ${status.current.seed}`
                : "正在连接本地调试服务…"
            }}
          </p>
          <h2 class="mt-2 text-lg font-semibold">
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
        <span
          v-if="phase"
          class="shrink-0 rounded-full border px-3 py-1 text-xs"
          :class="
            phase === 'completed'
              ? 'border-arena-accent/30 bg-arena-accent/10 text-arena-accent'
              : phase === 'error'
                ? 'border-arena-danger/40 bg-arena-danger/10 text-arena-danger'
                : 'border-arena-border text-arena-muted'
          "
        >
          {{ phase === "running" ? "RUNNING" : phase === "completed" ? "COMPLETED" : "ERROR" }}
        </span>
      </div>

      <div v-if="phase === 'running' && current" class="mt-4">
        <div class="flex flex-wrap items-center gap-2 text-sm text-arena-muted">
          <span data-testid="dev-progress"
            >已完成 {{ current.completedTicks }} / {{ current.maxTicks }} tick</span
          >
        </div>
        <div
          class="mt-2 h-2 w-full overflow-hidden rounded-full bg-arena-background"
          role="progressbar"
          aria-label="比赛进度"
          :aria-valuenow="current.completedTicks"
          aria-valuemin="0"
          :aria-valuemax="current.maxTicks"
        >
          <div
            class="h-full rounded-full bg-arena-accent"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
      </div>

      <p
        v-if="phase === 'error' && current?.message"
        role="alert"
        class="mt-4 break-words rounded-lg border border-arena-danger/40 bg-arena-danger/5 p-3 text-sm text-arena-danger"
      >
        {{ current.message }}
      </p>
      <p v-if="phase === 'error' && status?.lastCompleted" class="mt-3 text-xs text-arena-muted">
        下方仍显示第 {{ status.lastCompleted.run }} 局的结果，修复代码后可重新开局。
      </p>

      <div v-if="ranking.length" class="mt-5 border-t border-arena-border pt-4">
        <h3 class="text-sm font-semibold">
          {{ phase === "completed" ? "本局排名" : `第 ${status?.lastCompleted?.run} 局排名` }}
        </h3>
        <p v-for="entry in ranking" :key="entry.id" class="mt-2 text-sm text-arena-muted">
          第 {{ entry.rank }} 名 · {{ entry.name }} · {{ entry.score }} 分
        </p>
      </div>

      <div
        v-if="players.length"
        class="mt-5 flex flex-wrap gap-2 border-t border-arena-border pt-4"
      >
        <span
          v-for="player in players"
          :key="player.id"
          class="rounded-full border border-arena-border px-3 py-1 text-xs text-arena-muted"
        >
          {{ player.name }}{{ player.official ? " · 官方" : "" }}
        </span>
      </div>

      <p v-if="status?.memoryTruncated" class="mt-4 text-xs text-arena-danger">
        本地会话的 Memory 记录已达上限，之后的 tick 不再记录新的提交，对比可能停留在旧值。
      </p>
    </div>

    <p
      v-if="sessionError"
      role="alert"
      class="panel mt-8 break-words border-arena-danger/50 p-6 text-arena-danger"
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
    />
  </section>
</template>
