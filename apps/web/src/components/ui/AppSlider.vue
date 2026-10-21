<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min: number;
    max: number;
    step?: number | undefined;
    /** 无障碍名称。 */
    label?: string | undefined;
    /** 读屏时播报的当前值描述。 */
    valueText?: string | undefined;
    disabled?: boolean | undefined;
    /** Values highlighted on the track, such as ticks with execution errors. */
    marks?: readonly number[] | undefined;
  }>(),
  { step: 1 },
);
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

/** 拇指直径。拇指中心在轨道两端各留半个直径，贴边时不会溢出轨道。 */
const THUMB_SIZE = 16;

const track = ref<HTMLElement | null>(null);
const dragging = ref(false);

const span = computed(() => Math.max(1, props.max - props.min));
const ratio = computed(() => {
  if (props.max <= props.min) return 0;
  return Math.min(1, Math.max(0, (props.modelValue - props.min) / span.value));
});
/** 拇指中心相对轨道的偏移；填充部分与拇指共用同一个位置。 */
function offset(value: number) {
  return `calc(${THUMB_SIZE / 2}px + (100% - ${THUMB_SIZE}px) * ${value})`;
}
const thumbPosition = computed(() => offset(ratio.value));
const markPositions = computed(() =>
  props.max <= props.min
    ? []
    : (props.marks ?? []).map((value) => ({
        value,
        left: offset(Math.min(1, Math.max(0, (value - props.min) / span.value))),
      })),
);

function clamp(value: number) {
  return Math.min(props.max, Math.max(props.min, value));
}
function valueFromClientX(clientX: number) {
  const rect = track.value?.getBoundingClientRect();
  if (!rect) return props.modelValue;
  const usable = rect.width - THUMB_SIZE;
  if (usable <= 0) return props.min;
  const position = Math.min(1, Math.max(0, (clientX - rect.left - THUMB_SIZE / 2) / usable));
  const raw = props.min + position * span.value;
  return clamp(Math.round((raw - props.min) / props.step) * props.step + props.min);
}
function onPointerDown(event: PointerEvent) {
  if (props.disabled) return;
  dragging.value = true;
  const element = event.currentTarget as HTMLElement;
  element.setPointerCapture?.(event.pointerId);
  // preventDefault 会挡掉默认的聚焦行为，这里自己补上。
  track.value?.focus();
  emit("update:modelValue", valueFromClientX(event.clientX));
  event.preventDefault();
}
function onPointerMove(event: PointerEvent) {
  if (!dragging.value || props.disabled) return;
  emit("update:modelValue", valueFromClientX(event.clientX));
}
function onPointerUp(event: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
}
function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return;
  const step = props.step;
  let next: number;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowUp":
      next = props.modelValue + step;
      break;
    case "ArrowLeft":
    case "ArrowDown":
      next = props.modelValue - step;
      break;
    case "PageUp":
      next = props.modelValue + step * 10;
      break;
    case "PageDown":
      next = props.modelValue - step * 10;
      break;
    case "Home":
      next = props.min;
      break;
    case "End":
      next = props.max;
      break;
    default:
      return;
  }
  // 这些按键由滑块自己消费，不要再冒泡给外层的快捷键处理。
  event.preventDefault();
  event.stopPropagation();
  emit("update:modelValue", clamp(next));
}
</script>

<template>
  <div
    ref="track"
    role="slider"
    tabindex="0"
    class="group relative flex h-7 w-full touch-none select-none items-center focus:outline-none"
    :class="disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    :aria-valuetext="valueText"
    :aria-disabled="disabled ? 'true' : undefined"
    @keydown="onKeydown"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div class="pointer-events-none absolute inset-x-0 h-1 rounded-full bg-line"></div>
    <div
      class="pointer-events-none absolute left-0 h-1 rounded-full bg-accent"
      :style="{ width: thumbPosition }"
    ></div>
    <span
      v-for="mark in markPositions"
      :key="mark.value"
      class="pointer-events-none absolute h-5 w-[3px] -translate-x-1/2 rounded-full bg-danger"
      :style="{ left: mark.left }"
      aria-hidden="true"
    ></span>
    <div
      class="pointer-events-none absolute size-4 rounded-full bg-ink shadow-[0_0_0_3px_var(--color-background)] group-focus-visible:ring-4 group-focus-visible:ring-accent/40"
      :style="{ left: thumbPosition, transform: 'translateX(-50%)' }"
    ></div>
  </div>
</template>
