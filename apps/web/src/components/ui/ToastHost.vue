<script setup lang="ts">
import { computed } from "vue";
import { useToast } from "../../composables/useToast";

const { current, dismiss } = useToast();

const accents = {
  info: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

const live = computed(() => (current.value?.tone === "danger" ? "assertive" : "polite"));
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3 sm:pt-5"
    :aria-live="live"
    role="status"
  >
    <Transition name="toast">
      <div
        v-if="current"
        class="pointer-events-auto flex w-full max-w-[30rem] items-start gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-pop"
      >
        <span
          class="mt-1.5 size-1.5 shrink-0 rounded-full"
          :class="accents[current.tone]"
          aria-hidden="true"
        />
        <p class="min-w-0 flex-1 text-sm leading-6 text-ink">{{ current.message }}</p>
        <button
          type="button"
          class="-mt-0.5 -mr-1 shrink-0 rounded-md px-1.5 py-0.5 text-sm leading-5 text-faint transition hover:bg-muted hover:text-ink"
          aria-label="关闭提示"
          @click="dismiss"
        >
          ✕
        </button>
      </div>
    </Transition>
  </div>
</template>
