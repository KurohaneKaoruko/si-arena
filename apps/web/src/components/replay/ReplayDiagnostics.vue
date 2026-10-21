<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import type { BrowserReplaySession, ReplayView } from "@si-arena/player/browser";
import AppSelect from "../ui/AppSelect.vue";
import { own, type MemoryLoader } from "./replay-diagnostics";

const props = defineProps<{
  session: BrowserReplaySession;
  view: ReplayView;
  tick: number;
  memory?: MemoryLoader | undefined;
}>();
const playerId = defineModel<string>("playerId", { required: true });
const observationOpen = ref(false);
const playerOptions = computed(() =>
  props.session.replay.players
    .toSorted((a, b) => a.slot - b.slot)
    .map((player) => ({ value: player.id, label: `P${player.slot + 1} · ${player.name}` })),
);
const selectedError = computed(() => own(props.view.record?.errors, playerId.value));
const selectedResources = computed(() => own(props.view.record?.resources, playerId.value));
const selectedAction = computed(() => own(props.view.record?.actions, playerId.value));
const selectedObservation = computed(() =>
  observationOpen.value ? JSON.stringify(props.view.observation(playerId.value), null, 2) : "",
);

const memoryState = shallowRef<{ before: unknown; after: unknown } | null>(null);
const memoryPending = ref(false);
let memoryRequest = 0;
watch(
  [() => props.view.record?.tick, playerId],
  async () => {
    const request = ++memoryRequest;
    const loader = props.memory;
    const inputTick = props.view.record?.tick;
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
</script>

<template>
  <section class="card space-y-3 p-5" aria-labelledby="diagnostics-title">
    <div class="flex flex-wrap items-center justify-between gap-2.5">
      <h2 id="diagnostics-title" class="text-base font-bold">Tick 诊断</h2>
      <span class="flex min-w-0 items-center gap-2 text-[13px] text-soft">
        选手
        <AppSelect
          id="diagnostic-player"
          class="w-44 max-w-full"
          size="sm"
          label="选手"
          :model-value="playerId"
          :options="playerOptions"
          @update:model-value="playerId = $event"
        />
      </span>
    </div>
    <p class="font-mono text-[13px] text-soft">
      {{
        view.record
          ? `执行 tick ${view.record.tick} → 世界 S${tick}`
          : "初始世界 S0，还没有执行记录"
      }}
    </p>
    <div
      v-if="selectedError"
      class="min-w-0 space-y-1.5 rounded-control border border-danger-line bg-danger-soft p-3"
      role="note"
      aria-label="玩家执行错误"
    >
      <p class="font-mono text-xs break-words text-danger-ink">{{ selectedError.type }}</p>
      <p class="text-[13px] break-words text-danger-pale">{{ selectedError.message }}</p>
      <details v-if="selectedError.stack">
        <summary class="cursor-pointer py-1 text-xs text-danger-ink">错误堆栈</summary>
        <pre
          class="max-h-48 overflow-auto overscroll-contain font-mono text-[11px] leading-5 break-all whitespace-pre-wrap text-danger-pale"
          >{{ selectedError.stack }}</pre>
      </details>
    </div>
    <dl class="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
      <dt class="text-faint">有效动作</dt>
      <dd class="font-mono break-all">
        {{ selectedAction === undefined ? "无执行动作" : JSON.stringify(selectedAction) }}
      </dd>
      <dt class="text-faint">CPU</dt>
      <dd class="font-mono">
        {{
          selectedResources?.cpuUsedUs === undefined
            ? "未记录"
            : `${(selectedResources.cpuUsedUs / 1000).toFixed(2)} ms`
        }}
      </dd>
    </dl>
    <div v-if="memory" class="min-w-0 border-t border-line pt-3" aria-label="Memory 提交">
      <p class="text-[13px] font-bold">Memory 提交</p>
      <p v-if="!view.record" class="mt-1.5 text-xs leading-6 text-faint">
        前进一步后可查看 tick 0 的 Memory 提交。
      </p>
      <p v-else-if="memoryPending" class="mt-1.5 text-xs leading-6 text-faint">加载中…</p>
      <template v-else-if="memoryState">
        <p class="mt-1.5 text-xs text-faint">提交前</p>
        <pre
          class="mt-1 max-h-40 overflow-auto overscroll-contain rounded-[0.5rem] bg-background px-3 py-2 font-mono text-xs leading-6 break-all whitespace-pre-wrap text-ink"
          >{{ formatMemory(memoryState.before) }}</pre>
        <p class="mt-1.5 text-xs text-faint">提交后</p>
        <pre
          class="mt-1 max-h-40 overflow-auto overscroll-contain rounded-[0.5rem] bg-background px-3 py-2 font-mono text-xs leading-6 break-all whitespace-pre-wrap text-ink"
          >{{ formatMemory(memoryState.after) }}</pre>
      </template>
      <p v-else class="mt-1.5 text-xs leading-6 text-faint">该选手在此 tick 没有 Memory 记录。</p>
    </div>
    <details class="min-w-0" @toggle="observationOpen = ($event.target as HTMLDetailsElement).open">
      <summary
        class="flex min-h-9 cursor-pointer items-center text-[13px] text-soft transition hover:text-ink"
      >
        查看执行前的观察
      </summary>
      <pre
        v-if="observationOpen"
        class="mt-2 max-h-60 overflow-auto overscroll-contain rounded-[0.5rem] bg-background px-3 py-2 font-mono text-xs leading-6 break-all whitespace-pre-wrap text-soft"
        >{{ selectedObservation }}</pre>
    </details>
  </section>
</template>
