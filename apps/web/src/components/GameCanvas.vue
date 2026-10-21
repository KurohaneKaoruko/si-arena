<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  aspectRatio: number;
  label: string;
  fit?: boolean;
  describedBy?: string;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
}>();
const container = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const error = ref("");
let observer: ResizeObserver | undefined;

function redraw() {
  const element = canvas.value;
  const bounds = container.value?.getBoundingClientRect();
  if (!element || !bounds) return;
  const width = Math.max(
    1,
    Math.min(bounds.width || 800, (bounds.height || 800 / props.aspectRatio) * props.aspectRatio),
  );
  const height = width / props.aspectRatio;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  const context = element.getContext("2d");
  if (!context) {
    error.value = "当前浏览器无法显示 Canvas 地图，请使用支持 Canvas 的浏览器。";
    return;
  }
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  element.width = Math.round(width * ratio);
  element.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  try {
    props.draw(context, width, height);
    error.value = "";
  } catch {
    error.value = "游戏画面无法显示，请重新加载。";
  }
}
watch(() => [props.draw, props.aspectRatio, props.fit], redraw, { flush: "post" });
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(redraw);
    observer.observe(container.value!);
  }
  window.addEventListener("resize", redraw);
  redraw();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", redraw);
});
defineExpose({ redraw });
</script>

<template>
  <div
    ref="container"
    class="game-canvas"
    :class="{ 'game-canvas--fit': fit }"
    :style="{ aspectRatio }"
  >
    <canvas
      ref="canvas"
      class="block max-w-full"
      tabindex="0"
      role="img"
      :aria-label="label"
      :aria-describedby="describedBy"
      >{{ label }}</canvas
    >
    <p
      v-if="error"
      role="alert"
      class="absolute inset-x-3 bottom-3 rounded-control border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
    >
      {{ error }}
    </p>
  </div>
</template>
