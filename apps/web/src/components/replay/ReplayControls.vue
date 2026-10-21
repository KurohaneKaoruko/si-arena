<script setup lang="ts">
import { computed } from "vue";
import { PLAYBACK_SPEEDS, type usePlayback } from "@si-arena/player";
import type { BrowserReplaySession } from "@si-arena/player/browser";
import AppButton from "../ui/AppButton.vue";
import AppSelect from "../ui/AppSelect.vue";
import AppSlider from "../ui/AppSlider.vue";

const props = defineProps<{
  session: BrowserReplaySession;
  playback: ReturnType<typeof usePlayback>;
}>();
const emit = defineEmits<{ toggle: []; jumpError: [direction: -1 | 1] }>();
const { tick, playing, speed, previousError, nextError } = props.playback;
const speedOptions = PLAYBACK_SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }));
// Error marks sit on the world produced by the failing input tick.
const marks = computed(() => props.session.errorTicks.map((inputTick) => inputTick + 1));
function seek(event: Event) {
  props.playback.seek(Number((event.target as HTMLInputElement).value));
}
</script>

<template>
  <div class="card shrink-0 px-4 py-3.5">
    <AppSlider
      :model-value="tick"
      :min="0"
      :max="session.totalTicks"
      :marks="marks"
      label="已完成 tick 时间轴"
      :value-text="`已完成 ${tick} tick`"
      @update:model-value="playback.seek"
    />
    <div class="mt-2.5 flex flex-wrap items-center gap-2">
      <AppButton
        size="icon"
        aria-label="回到初始世界"
        :disabled="tick === 0"
        @click="playback.seek(0)"
      >
        <svg class="size-[18px]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 5v14M18 6l-9 6 9 6z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </AppButton>
      <AppButton
        size="icon"
        aria-label="后退一个 tick"
        :disabled="tick === 0"
        @click="playback.step(-1)"
      >
        <svg class="size-[18px]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 6l-6 6 6 6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </AppButton>
      <AppButton variant="primary" class="px-5" :aria-pressed="playing" @click="emit('toggle')">
        <svg
          v-if="!playing"
          class="size-4"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M7 4.5v15l13-7.5z" />
        </svg>
        {{ playing ? "暂停" : tick === session.totalTicks ? "重新播放" : "播放" }}
      </AppButton>
      <AppButton
        size="icon"
        aria-label="前进一个 tick"
        :disabled="tick === session.totalTicks"
        @click="playback.step(1)"
      >
        <svg class="size-[18px]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 6l6 6-6 6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </AppButton>
      <span class="ml-1 flex items-center gap-2 text-sm text-soft">
        速度
        <AppSelect
          class="w-20 font-mono"
          label="播放速度"
          :model-value="String(speed)"
          :options="speedOptions"
          @update:model-value="playback.setSpeed(Number($event))"
        />
      </span>
      <label class="flex items-center gap-2 text-sm text-soft" for="replay-tick"
        >跳到 tick
        <input
          id="replay-tick"
          class="input w-[5.5rem] font-mono text-sm"
          type="number"
          min="0"
          :max="session.totalTicks"
          :value="tick"
          @change="seek"
        />
      </label>
      <span v-if="session.errorTicks.length" class="ml-auto flex gap-2">
        <AppButton
          variant="danger"
          :disabled="previousError === undefined"
          @click="emit('jumpError', -1)"
          >上一处错误</AppButton
        >
        <AppButton
          variant="danger"
          :disabled="nextError === undefined"
          @click="emit('jumpError', 1)"
          >下一处错误</AppButton
        >
      </span>
    </div>
    <p id="playback-help" class="mt-2.5 text-xs text-faint">
      聚焦画面后：空格 播放/暂停 · ← → 逐步 · Home / End 首尾
    </p>
  </div>
</template>
