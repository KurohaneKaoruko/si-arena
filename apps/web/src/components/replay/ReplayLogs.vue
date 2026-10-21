<script setup lang="ts">
import { computed, ref } from "vue";
import type { ReplayView } from "@si-arena/player/browser";
import AppSelect from "../ui/AppSelect.vue";
import { own } from "./replay-diagnostics";

const props = defineProps<{ view: ReplayView; playerId: string }>();
const level = ref("all");
const levelOptions = [
  { value: "all", label: "全部" },
  ...["log", "info", "warn", "error", "debug"].map((name) => ({ value: name, label: name })),
];
const logs = computed(() =>
  (own(props.view.record?.logs, props.playerId) ?? []).filter(
    (log) => level.value === "all" || level.value === log.level,
  ),
);
const truncated = computed(() => own(props.view.record?.logsTruncated, props.playerId));
const levelColors: Record<string, string> = {
  error: "text-danger-ink",
  warn: "text-warning",
  info: "text-player-0",
};
</script>

<template>
  <section class="card min-w-0 space-y-3 p-5" aria-labelledby="logs-title">
    <div class="flex flex-wrap items-center justify-between gap-2.5">
      <h2 id="logs-title" class="text-base font-bold">
        玩家日志
        <span class="ml-1 font-mono text-xs font-normal text-faint">{{
          view.record ? `INPUT TICK ${view.record.tick}` : "S0"
        }}</span>
      </h2>
      <span class="flex items-center gap-2 text-[13px] text-soft">
        级别
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
    <ol
      v-if="logs.length"
      class="max-h-72 space-y-2 overflow-auto overscroll-contain rounded-control bg-background p-3 font-mono text-xs leading-5"
      aria-label="当前 tick 玩家日志"
    >
      <li v-for="(log, index) in logs" :key="index" class="grid grid-cols-[3.25rem_1fr] gap-2.5">
        <span class="font-semibold" :class="levelColors[log.level] ?? 'text-faint'">{{
          log.level
        }}</span>
        <pre
          class="min-w-0 break-all whitespace-pre-wrap"
          :class="log.level === 'error' ? 'text-danger-ink' : 'text-ink'"
          >{{ log.message }}</pre>
      </li>
    </ol>
    <p v-else class="text-sm leading-7 text-soft">
      {{
        view.record
          ? "该选手在当前 tick 没有符合筛选条件的日志。"
          : "前进一步后可查看执行 tick 0 的日志。"
      }}
    </p>
    <p v-if="truncated" class="text-xs text-warning">该 tick 的日志已达到预算，部分内容被截断。</p>
  </section>
</template>
