<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { PLAYBACK_SPEEDS, usePlayback } from "@si-arena/player";
import type { BrowserReplaySession } from "@si-arena/player/browser";

const props = defineProps<{
  session: BrowserReplaySession;
  fileName: string;
  /** Live dev sessions only: Memory committed around the executed input tick. */
  memory?: (
    tick: number,
    playerId: string,
  ) => Promise<{ before: unknown; after: unknown } | undefined>;
}>();
const source = shallowRef<BrowserReplaySession | null>(props.session);
watch(
  () => props.session,
  (value) => {
    source.value = value;
  },
);
const playback = usePlayback(
  source,
  {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  },
  // Playing frames redraw through the clock callback so event animations advance between ticks.
  { onFrame: draw },
);
const reducedMotionQuery =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const { tick, playing, speed, previousError, nextError } = playback;
const view = computed(() => props.session.view(tick.value));
const participants = computed(() =>
  props.session.replay.players.toSorted((a, b) => a.slot - b.slot),
);
const playerId = ref(participants.value[0]!.id),
  level = ref("all");
const canvas = ref<HTMLCanvasElement | null>(null);
const canvasError = ref("");
const observationOpen = ref(false);
function own<T>(map: Readonly<Record<string, T>> | undefined, id: string): T | undefined {
  return map && Object.hasOwn(map, id) ? map[id] : undefined;
}
const selectedLogs = computed(() =>
  (own(view.value.record?.logs, playerId.value) ?? []).filter(
    (log) => level.value === "all" || level.value === log.level,
  ),
);
const selectedError = computed(() => own(view.value.record?.errors, playerId.value));
const selectedResources = computed(() => own(view.value.record?.resources, playerId.value));
const selectedAction = computed(() => own(view.value.record?.actions, playerId.value));
const logsTruncated = computed(() => own(view.value.record?.logsTruncated, playerId.value));
const selectedObservation = computed(() =>
  observationOpen.value ? JSON.stringify(view.value.observation(playerId.value), null, 2) : "",
);
const memoryState = shallowRef<{ before: unknown; after: unknown } | null>(null);
const memoryPending = ref(false);
let memoryRequest = 0;
watch(
  [() => view.value.record?.tick, playerId],
  async () => {
    const request = ++memoryRequest;
    const loader = props.memory;
    const inputTick = view.value.record?.tick;
    memoryState.value = null;
    memoryPending.value = loader !== undefined && inputTick !== undefined;
    if (!loader || inputTick === undefined) return;
    try {
      const value = await loader(inputTick, playerId.value);
      if (request === memoryRequest) memoryState.value = value ?? null;
    } catch {
      if (request === memoryRequest) memoryState.value = null;
    } finally {
      if (request === memoryRequest) memoryPending.value = false;
    }
  },
  { immediate: true },
);
function formatMemory(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}
const canvasLabel = computed(
  () =>
    `比赛地图，已完成 ${tick.value} tick。${view.value.players.map((p) => `${p.label} 得分 ${p.score} ${props.session.scoreUnit}，${p.alive ? "存活" : "淘汰"}`).join("；")}`,
);
let observer: ResizeObserver | undefined;
function draw() {
  const element = canvas.value;
  if (!element) return;
  const context = element.getContext("2d");
  if (!context) {
    canvasError.value = "当前浏览器无法显示 Canvas 地图，请使用支持 Canvas 的浏览器。";
    return;
  }
  const width = Math.max(1, element.getBoundingClientRect().width || 800);
  const height = width / props.session.aspectRatio;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  element.width = Math.round(width * ratio);
  element.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  view.value.draw(context, width, height, {
    progress: playback.progress.value,
    reducedMotion: reducedMotionQuery?.matches ?? false,
  });
}
// Seeks and source swaps redraw the settled world while paused; playing draws come from onFrame.
watch(
  view,
  () => {
    if (!playing.value) draw();
  },
  { flush: "post" },
);
function handleVisibility() {
  if (document.hidden) playback.pause();
}
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(draw);
    observer.observe(canvas.value!);
  }
  window.addEventListener("resize", draw);
  document.addEventListener("visibilitychange", handleVisibility);
  draw();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", draw);
  document.removeEventListener("visibilitychange", handleVisibility);
});
function toggle() {
  if (playing.value) playback.pause();
  else playback.play();
}
function seek(event: Event) {
  playback.seek(Number((event.target as HTMLInputElement).value));
}
function setSpeed(event: Event) {
  playback.setSpeed(Number((event.target as HTMLSelectElement).value));
}
function jumpError(direction: -1 | 1) {
  playback.jumpError(direction);
  const errors = view.value.record?.errors;
  if (errors && !Object.hasOwn(errors, playerId.value))
    playerId.value = Object.keys(errors)[0] ?? playerId.value;
}
function keyboard(event: KeyboardEvent) {
  if (
    event.target instanceof HTMLElement &&
    event.target.closest("input,select,textarea,button,a,summary")
  )
    return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === " ") toggle();
  else if (event.key === "ArrowLeft") playback.step(-1);
  else if (event.key === "ArrowRight") playback.step(1);
  else if (event.key === "Home") playback.seek(0);
  else if (event.key === "End") playback.seek(props.session.totalTicks);
  else return;
  event.preventDefault();
}
</script>

<template>
  <section class="min-w-0" aria-label="比赛回放" @keydown="keyboard">
    <div class="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate text-sm text-arena-muted" :title="fileName">{{ fileName }}</p>
        <p class="mt-1 break-all font-mono text-xs text-arena-muted">
          {{ session.replay.game.release }} · {{ session.replay.matchId }}
        </p>
      </div>
      <span
        class="rounded-full border border-arena-accent/30 bg-arena-accent/10 px-3 py-1 text-xs text-arena-accent"
        >回放校验通过</span
      >
    </div>
    <div class="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div class="min-w-0">
        <div class="panel overflow-hidden">
          <div
            class="flex flex-wrap items-center justify-between gap-2 border-b border-arena-border px-4 py-3"
          >
            <span class="font-mono text-sm" data-testid="tick-count"
              >已完成 {{ tick }} / {{ session.totalTicks }} tick</span
            >
            <span class="text-xs text-arena-muted">{{
              tick === session.totalTicks ? "比赛结束" : playing ? "播放中" : "已暂停"
            }}</span>
          </div>
          <canvas
            ref="canvas"
            class="block w-full"
            :style="{ aspectRatio: session.aspectRatio }"
            tabindex="0"
            role="img"
            :aria-label="canvasLabel"
            aria-describedby="playback-help"
            >{{ canvasLabel }}</canvas
          >
          <p v-if="canvasError" role="alert" class="p-4 text-arena-danger">{{ canvasError }}</p>
        </div>
        <div class="panel mt-4 p-4">
          <label for="replay-timeline" class="sr-only">已完成 tick 时间轴</label>
          <input
            id="replay-timeline"
            class="block min-h-11 w-full cursor-pointer accent-arena-accent"
            type="range"
            min="0"
            :max="session.totalTicks"
            :value="tick"
            :aria-valuetext="`已完成 ${tick} tick`"
            @input="seek"
          />
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="button-secondary !px-3"
              aria-label="回到初始世界"
              :disabled="tick === 0"
              @click="playback.seek(0)"
            >
              起点
            </button>
            <button
              type="button"
              class="button-secondary !px-3"
              aria-label="后退一个 tick"
              :disabled="tick === 0"
              @click="playback.step(-1)"
            >
              上一步
            </button>
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center rounded-lg bg-arena-accent px-5 text-sm font-semibold text-arena-background hover:brightness-110"
              :aria-pressed="playing"
              @click="toggle"
            >
              {{ playing ? "暂停" : tick === session.totalTicks ? "重新播放" : "播放" }}
            </button>
            <button
              type="button"
              class="button-secondary !px-3"
              aria-label="前进一个 tick"
              :disabled="tick === session.totalTicks"
              @click="playback.step(1)"
            >
              下一步
            </button>
            <label class="ml-auto flex items-center gap-2 text-sm text-arena-muted"
              >速度
              <select class="replay-input" aria-label="播放速度" :value="speed" @change="setSpeed">
                <option v-for="value in PLAYBACK_SPEEDS" :key="value" :value="value">
                  {{ value }}×
                </option>
              </select>
            </label>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-3 border-t border-arena-border pt-3">
            <label class="flex items-center gap-2 text-sm text-arena-muted" for="replay-tick"
              >跳转 tick
              <input
                id="replay-tick"
                class="replay-input w-24"
                type="number"
                min="0"
                :max="session.totalTicks"
                :value="tick"
                @change="seek"
              />
            </label>
            <button
              type="button"
              class="button-secondary !px-3"
              :disabled="previousError === undefined"
              @click="jumpError(-1)"
            >
              上一处错误
            </button>
            <button
              type="button"
              class="button-secondary !px-3"
              :disabled="nextError === undefined"
              @click="jumpError(1)"
            >
              下一处错误
            </button>
          </div>
          <p id="playback-help" class="mt-3 text-xs leading-6 text-arena-muted">
            聚焦地图：空格播放 / 暂停，← → 逐步查看，Home / End 跳转首尾。
          </p>
        </div>
      </div>
      <aside class="min-w-0 space-y-4" aria-label="选手与诊断">
        <div class="panel p-4">
          <h2 class="text-sm font-semibold">选手与得分</h2>
          <div v-for="player in view.players" :key="player.id" class="mt-4 min-w-0">
            <div class="flex min-w-0 items-start gap-3">
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold"
                :style="{ color: player.color, borderColor: player.color }"
                >{{ player.label }}</span
              >
              <div class="min-w-0 flex-1">
                <p
                  class="truncate text-sm"
                  :title="participants.find((p) => p.id === player.id)?.name"
                >
                  {{ participants.find((p) => p.id === player.id)?.name }}
                </p>
                <p class="mt-1 text-xs text-arena-muted">
                  {{ participants.find((p) => p.id === player.id)?.official ? "官方 · " : ""
                  }}{{ player.alive ? "存活" : "已淘汰" }}
                </p>
              </div>
              <p class="shrink-0 text-right font-mono text-lg" :style="{ color: player.color }">
                {{ player.score
                }}<span class="ml-1 text-xs text-arena-muted">{{ session.scoreUnit }}</span>
              </p>
            </div>
          </div>
          <div v-if="tick === session.totalTicks" class="mt-5 border-t border-arena-border pt-4">
            <h3 class="text-sm font-semibold">终局排名</h3>
            <p
              v-for="result in session.replay.result.players"
              :key="result.id"
              class="mt-2 break-words text-sm text-arena-muted"
            >
              第 {{ result.rank }} 名 · {{ participants.find((p) => p.id === result.id)?.name }} ·
              {{ result.score }} 分
            </p>
          </div>
        </div>
        <div class="panel min-w-0 p-4">
          <h2 class="text-sm font-semibold">Tick 诊断</h2>
          <p class="mt-2 text-xs leading-6 text-arena-muted">
            {{
              view.record
                ? `执行 tick ${view.record.tick} → 世界 S${tick}`
                : "初始世界 S0，还没有执行记录"
            }}
          </p>
          <label class="mt-3 block text-xs text-arena-muted" for="diagnostic-player">选手</label>
          <select id="diagnostic-player" v-model="playerId" class="replay-input mt-1 w-full">
            <option v-for="player in participants" :key="player.id" :value="player.id">
              P{{ player.slot + 1 }} · {{ player.name }}
            </option>
          </select>
          <div
            v-if="selectedError"
            class="mt-4 min-w-0 rounded-lg border border-arena-danger/40 bg-arena-danger/5 p-3"
            role="note"
            aria-label="玩家执行错误"
          >
            <p class="break-words font-mono text-xs font-semibold text-arena-danger">
              {{ selectedError.type }}
            </p>
            <p class="mt-2 break-words text-sm text-arena-danger">{{ selectedError.message }}</p>
            <details v-if="selectedError.stack" class="mt-2">
              <summary class="cursor-pointer py-2 text-xs text-arena-muted">错误堆栈</summary>
              <pre
                class="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs leading-6 text-arena-muted"
                >{{ selectedError.stack }}</pre>
            </details>
          </div>
          <div class="mt-4 text-xs leading-6 text-arena-muted">
            <p>有效动作</p>
            <pre
              class="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono text-arena-text"
              >{{
                selectedAction === undefined ? "无执行动作" : JSON.stringify(selectedAction)
              }}</pre>
            <p class="mt-2">
              CPU：{{
                selectedResources?.cpuUsedUs === undefined
                  ? "未记录"
                  : `${(selectedResources.cpuUsedUs / 1000).toFixed(2)} ms`
              }}
            </p>
          </div>
          <div
            v-if="memory"
            class="mt-4 min-w-0 border-t border-arena-border pt-3"
            aria-label="Memory 提交"
          >
            <p class="text-xs font-semibold">Memory 提交</p>
            <p v-if="!view.record" class="mt-2 text-xs leading-6 text-arena-muted">
              前进一步后可查看 tick 0 的 Memory 提交。
            </p>
            <p v-else-if="memoryPending" class="mt-2 text-xs leading-6 text-arena-muted">加载中…</p>
            <template v-else-if="memoryState">
              <p class="mt-2 text-xs text-arena-muted">提交前</p>
              <pre
                class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-6 text-arena-text"
                >{{ formatMemory(memoryState.before) }}</pre>
              <p class="mt-2 text-xs text-arena-muted">提交后</p>
              <pre
                class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-6 text-arena-text"
                >{{ formatMemory(memoryState.after) }}</pre>
            </template>
            <p v-else class="mt-2 text-xs leading-6 text-arena-muted">
              该选手在此 tick 没有 Memory 记录。
            </p>
          </div>
          <details
            class="mt-3 min-w-0 border-t border-arena-border pt-2"
            @toggle="observationOpen = ($event.target as HTMLDetailsElement).open"
          >
            <summary class="min-h-11 cursor-pointer py-3 text-sm text-arena-muted">
              查看执行前的观察
            </summary>
            <pre
              v-if="observationOpen"
              class="max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-6 text-arena-muted"
              >{{ selectedObservation }}</pre>
          </details>
        </div>
      </aside>
    </div>
    <section class="panel mt-5 min-w-0 p-4 sm:p-5" aria-labelledby="logs-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="logs-title" class="text-sm font-semibold">
          玩家日志
          <span class="ml-2 font-mono text-xs text-arena-muted">{{
            view.record ? `INPUT TICK ${view.record.tick}` : "S0"
          }}</span>
        </h2>
        <label class="flex items-center gap-2 text-xs text-arena-muted" for="log-level"
          >日志级别<select id="log-level" v-model="level" class="replay-input">
            <option value="all">全部</option>
            <option
              v-for="name in ['log', 'info', 'warn', 'error', 'debug']"
              :key="name"
              :value="name"
            >
              {{ name }}
            </option>
          </select></label
        >
      </div>
      <p v-if="logsTruncated" class="mt-3 text-sm text-arena-danger">
        该 tick 的日志已达到预算，部分内容被截断。
      </p>
      <div
        v-if="selectedLogs.length"
        class="mt-4 max-h-72 space-y-2 overflow-auto rounded-lg bg-arena-background p-4"
        role="region"
        aria-label="当前 tick 玩家日志"
      >
        <div
          v-for="(log, index) in selectedLogs"
          :key="index"
          class="flex items-start gap-3 font-mono text-xs leading-6"
        >
          <span class="shrink-0 uppercase text-arena-muted">{{ log.level }}</span>
          <pre
            class="min-w-0 whitespace-pre-wrap break-all"
            :class="log.level === 'error' ? 'text-arena-danger' : 'text-arena-text'"
            >{{ log.message }}</pre>
        </div>
      </div>
      <p v-else class="mt-4 text-sm leading-7 text-arena-muted">
        {{
          view.record
            ? "该选手在当前 tick 没有符合筛选条件的日志。"
            : "前进一步后可查看执行 tick 0 的日志。"
        }}
      </p>
    </section>
  </section>
</template>
