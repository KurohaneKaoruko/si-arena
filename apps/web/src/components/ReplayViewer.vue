<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { PLAYBACK_SPEEDS, usePlayback } from "@si-arena/player";
import type { BrowserReplaySession } from "@si-arena/player/browser";
import GameCanvas from "./GameCanvas.vue";
import AppBadge from "./ui/AppBadge.vue";
import AppButton from "./ui/AppButton.vue";
import AppSelect from "./ui/AppSelect.vue";
import AppSlider from "./ui/AppSlider.vue";

const props = defineProps<{
  session: BrowserReplaySession;
  fileName: string;
  sourceKind?: "online" | "file" | "live";
  detailsTarget?: HTMLElement | null;
  fit?: boolean;
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
const logsAvailable = computed(
  () =>
    props.sourceKind !== "online" &&
    (props.memory !== undefined || props.sourceKind === "live" || props.session.hasLogs),
);
const playerId = ref(participants.value[0]!.id),
  level = ref("all");
const surface = ref<InstanceType<typeof GameCanvas> | null>(null);
const observationOpen = ref(false);
function own<T>(map: Readonly<Record<string, T>> | undefined, id: string): T | undefined {
  return map && Object.hasOwn(map, id) ? map[id] : undefined;
}
const speedOptions = computed(() =>
  PLAYBACK_SPEEDS.map((value) => ({ value: String(value), label: `${value}×` })),
);
const playerOptions = computed(() =>
  participants.value.map((player) => ({
    value: player.id,
    label: `P${player.slot + 1} · ${player.name}`,
  })),
);
const levelOptions = [
  { value: "all", label: "全部" },
  ...["log", "info", "warn", "error", "debug"].map((name) => ({ value: name, label: name })),
];
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
function tint(color: string): string {
  return `color-mix(in srgb, ${color} 8%, white)`;
}
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
function draw() {
  surface.value?.redraw();
}
function drawView(context: CanvasRenderingContext2D, width: number, height: number) {
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
  document.addEventListener("visibilitychange", handleVisibility);
  draw();
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibility);
});
function toggle() {
  if (playing.value) playback.pause();
  else playback.play();
}
function seek(event: Event) {
  playback.seek(Number((event.target as HTMLInputElement).value));
}
function setSpeed(value: string) {
  playback.setSpeed(Number(value));
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
    event.target.closest(
      "input,textarea,button,a,summary,[role=listbox],[role=option],[role=slider]",
    )
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
  <section
    class="min-w-0"
    :class="{ 'replay-workspace': fit }"
    aria-label="比赛回放"
    @keydown="keyboard"
  >
    <details v-if="sourceKind !== 'online'" class="mb-3 min-w-0 text-xs text-soft">
      <summary class="w-fit max-w-full cursor-pointer break-all py-1">{{ fileName }}</summary>
      <p class="mt-1 break-all font-mono">
        {{ session.replay.game.release }} · {{ session.replay.matchId }}
      </p>
      <AppBadge class="mt-2" tone="success">回放校验通过</AppBadge>
    </details>
    <div
      class="replay-layout"
      :class="
        fit
          ? 'replay-layout--fit'
          : 'grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]'
      "
    >
      <div class="min-w-0" :class="{ 'replay-stage': fit }">
        <div
          class="replay-controls rounded-card border border-line bg-surface px-4 py-3 shadow-card"
          :class="fit ? 'shrink-0' : 'sticky top-14 z-20 mb-3'"
        >
          <AppSlider
            :model-value="tick"
            :min="0"
            :max="session.totalTicks"
            label="已完成 tick 时间轴"
            :value-text="`已完成 ${tick} tick`"
            @update:model-value="playback.seek"
          />
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <AppButton
              variant="secondary"
              size="sm"
              aria-label="回到初始世界"
              :disabled="tick === 0"
              @click="playback.seek(0)"
              >起点</AppButton
            >
            <AppButton
              variant="secondary"
              size="sm"
              aria-label="后退一个 tick"
              :disabled="tick === 0"
              @click="playback.step(-1)"
              >上一步</AppButton
            >
            <AppButton variant="primary" size="sm" :aria-pressed="playing" @click="toggle">{{
              playing ? "暂停" : tick === session.totalTicks ? "重新播放" : "播放"
            }}</AppButton>
            <AppButton
              variant="secondary"
              size="sm"
              aria-label="前进一个 tick"
              :disabled="tick === session.totalTicks"
              @click="playback.step(1)"
              >下一步</AppButton
            >
            <span class="ml-auto flex items-center gap-2 text-sm text-soft">
              速度
              <AppSelect
                class="w-20"
                size="sm"
                label="播放速度"
                :model-value="String(speed)"
                :options="speedOptions"
                @update:model-value="setSpeed"
              />
            </span>

            <label class="flex items-center gap-2 text-sm text-soft" for="replay-tick"
              >跳转 tick
              <input
                id="replay-tick"
                class="input min-h-8 w-20"
                type="number"
                min="0"
                :max="session.totalTicks"
                :value="tick"
                @change="seek"
              />
            </label>
            <AppButton
              variant="secondary"
              size="sm"
              v-if="session.errorTicks.length"
              :disabled="previousError === undefined"
              @click="jumpError(-1)"
              >上一处错误</AppButton
            >
            <AppButton
              variant="secondary"
              size="sm"
              v-if="session.errorTicks.length"
              :disabled="nextError === undefined"
              @click="jumpError(1)"
              >下一处错误</AppButton
            >
          </div>
          <p id="playback-help" class="sr-only">
            聚焦地图：空格播放 / 暂停，← → 逐步查看，Home / End 跳转首尾。
          </p>
        </div>
        <div
          class="overflow-hidden rounded-card border border-line bg-surface shadow-card"
          :class="{ 'replay-map': fit }"
        >
          <div
            class="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-subtle px-4 py-2.5"
          >
            <span class="font-mono text-sm tracking-tight" data-testid="tick-count"
              >已完成 {{ tick }} / {{ session.totalTicks }} tick</span
            >
            <span class="text-xs text-soft">{{
              tick === session.totalTicks ? "比赛结束" : playing ? "播放中" : "已暂停"
            }}</span>
          </div>
          <GameCanvas
            ref="surface"
            described-by="playback-help"
            :aspect-ratio="session.aspectRatio"
            :label="canvasLabel"
            :draw="drawView"
            :fit="fit"
          />
        </div>
      </div>
      <Teleport :to="detailsTarget ?? 'body'" :disabled="!detailsTarget">
        <aside class="min-w-0 space-y-4" aria-label="选手与诊断" @keydown="keyboard">
          <slot name="summary" />
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <h2 class="text-sm font-semibold">当前比分</h2>
            <div v-for="player in view.players" :key="player.id" class="mt-3.5 min-w-0">
              <div class="flex min-w-0 items-start gap-3">
                <span
                  class="flex size-8 shrink-0 items-center justify-center rounded-control border font-mono text-xs font-bold"
                  :style="{
                    color: player.color,
                    borderColor: player.color,
                    backgroundColor: tint(player.color),
                  }"
                  >{{ player.label }}</span
                >
                <div class="min-w-0 flex-1">
                  <p
                    class="truncate text-sm"
                    :title="participants.find((p) => p.id === player.id)?.name"
                  >
                    {{ participants.find((p) => p.id === player.id)?.name }}
                  </p>
                  <p class="mt-0.5 text-xs text-faint">
                    {{ participants.find((p) => p.id === player.id)?.official ? "官方 · " : ""
                    }}{{ player.alive ? "存活" : "已淘汰" }}
                  </p>
                </div>
                <p class="shrink-0 text-right font-mono text-lg" :style="{ color: player.color }">
                  {{ player.score
                  }}<span class="ml-1 text-xs text-faint">{{ session.scoreUnit }}</span>
                </p>
              </div>
            </div>
            <div v-if="tick === session.totalTicks" class="mt-4 border-t border-line pt-3.5">
              <h3 class="text-sm font-semibold">终局排名</h3>
              <p
                v-for="result in session.replay.result.players"
                :key="result.id"
                class="mt-1.5 break-words text-sm text-soft"
              >
                第 {{ result.rank }} 名 · {{ participants.find((p) => p.id === result.id)?.name }} ·
                {{ result.score }} 分
              </p>
            </div>
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <h2 class="text-sm font-semibold">Tick 诊断</h2>
            <p class="mt-1.5 text-xs leading-6 text-soft">
              {{
                view.record
                  ? `执行 tick ${view.record.tick} → 世界 S${tick}`
                  : "初始世界 S0，还没有执行记录"
              }}
            </p>
            <p class="mt-3 text-xs text-soft">选手</p>
            <AppSelect
              id="diagnostic-player"
              class="mt-1 w-full"
              label="选手"
              :model-value="playerId"
              :options="playerOptions"
              @update:model-value="playerId = $event"
            />
            <div
              v-if="selectedError"
              class="mt-3 min-w-0 rounded-control border border-danger/25 bg-danger-soft p-3"
              role="note"
              aria-label="玩家执行错误"
            >
              <p class="break-words font-mono text-xs font-semibold text-danger">
                {{ selectedError.type }}
              </p>
              <p class="mt-1.5 break-words text-sm text-danger">{{ selectedError.message }}</p>
              <details v-if="selectedError.stack" class="mt-1.5">
                <summary class="cursor-pointer py-1.5 text-xs text-soft">错误堆栈</summary>
                <pre
                  class="max-h-48 overflow-auto overscroll-contain whitespace-pre-wrap break-all font-mono text-xs leading-6 text-soft"
                  >{{ selectedError.stack }}</pre>
              </details>
            </div>
            <div class="mt-3 text-xs leading-6 text-soft">
              <p>有效动作</p>
              <pre
                class="mt-1 overflow-auto overscroll-contain whitespace-pre-wrap break-all rounded-control border border-line bg-subtle px-3 py-2 font-mono text-ink"
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
              class="mt-3 min-w-0 border-t border-line pt-3"
              aria-label="Memory 提交"
            >
              <p class="text-xs font-semibold">Memory 提交</p>
              <p v-if="!view.record" class="mt-1.5 text-xs leading-6 text-faint">
                前进一步后可查看 tick 0 的 Memory 提交。
              </p>
              <p v-else-if="memoryPending" class="mt-1.5 text-xs leading-6 text-faint">加载中…</p>
              <template v-else-if="memoryState">
                <p class="mt-1.5 text-xs text-faint">提交前</p>
                <pre
                  class="mt-1 max-h-40 overflow-auto overscroll-contain whitespace-pre-wrap break-all rounded-control border border-line bg-subtle px-3 py-2 font-mono text-xs leading-6 text-ink"
                  >{{ formatMemory(memoryState.before) }}</pre>
                <p class="mt-1.5 text-xs text-faint">提交后</p>
                <pre
                  class="mt-1 max-h-40 overflow-auto overscroll-contain whitespace-pre-wrap break-all rounded-control border border-line bg-subtle px-3 py-2 font-mono text-xs leading-6 text-ink"
                  >{{ formatMemory(memoryState.after) }}</pre>
              </template>
              <p v-else class="mt-1.5 text-xs leading-6 text-faint">
                该选手在此 tick 没有 Memory 记录。
              </p>
            </div>
            <details
              class="mt-2 min-w-0 border-t border-line pt-2"
              @toggle="observationOpen = ($event.target as HTMLDetailsElement).open"
            >
              <summary
                class="flex min-h-9 cursor-pointer items-center text-sm text-soft transition hover:text-ink"
              >
                查看执行前的观察
              </summary>
              <pre
                v-if="observationOpen"
                class="mt-2 max-h-60 overflow-auto overscroll-contain whitespace-pre-wrap break-all rounded-control border border-line bg-subtle px-3 py-2 font-mono text-xs leading-6 text-soft"
                >{{ selectedObservation }}</pre>
            </details>
          </div>
        </aside>
      </Teleport>
    </div>
    <section
      v-if="logsAvailable"
      class="mt-5 min-w-0 rounded-card border border-line bg-surface p-4"
      aria-labelledby="logs-title"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="logs-title" class="text-sm font-semibold">
          玩家日志
          <span class="ml-1.5 font-mono text-xs font-normal text-faint">{{
            view.record ? `INPUT TICK ${view.record.tick}` : "S0"
          }}</span>
        </h2>
        <span class="flex items-center gap-2 text-xs text-soft">
          日志级别
          <AppSelect
            id="log-level"
            class="w-28"
            size="sm"
            label="日志级别"
            :model-value="level"
            :options="levelOptions"
            @update:model-value="level = $event"
          />
        </span>
      </div>
      <p v-if="logsTruncated" class="mt-3 text-sm text-warning">
        该 tick 的日志已达到预算，部分内容被截断。
      </p>
      <div
        v-if="selectedLogs.length"
        class="mt-3 max-h-72 space-y-2 overflow-auto overscroll-contain rounded-control border border-line bg-subtle p-3.5"
        role="region"
        aria-label="当前 tick 玩家日志"
      >
        <div
          v-for="(log, index) in selectedLogs"
          :key="index"
          class="flex items-start gap-3 font-mono text-xs leading-6"
        >
          <span
            class="shrink-0 uppercase"
            :class="
              log.level === 'error'
                ? 'text-danger'
                : log.level === 'warn'
                  ? 'text-warning'
                  : 'text-faint'
            "
            >{{ log.level }}</span
          >
          <pre
            class="min-w-0 whitespace-pre-wrap break-all"
            :class="log.level === 'error' ? 'text-danger' : 'text-ink'"
            >{{ log.message }}</pre>
        </div>
      </div>
      <p v-else class="mt-3 text-sm leading-7 text-soft">
        {{
          view.record
            ? "该选手在当前 tick 没有符合筛选条件的日志。"
            : "前进一步后可查看执行 tick 0 的日志。"
        }}
      </p>
    </section>
    <p v-else-if="sourceKind !== 'online'" class="mt-3 text-xs text-soft">此回放未包含玩家日志。</p>
  </section>
</template>
