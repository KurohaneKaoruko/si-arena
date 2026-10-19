<script setup lang="ts">
withDefaults(
  defineProps<{
    status: "loading" | "empty" | "error";
    message?: string | undefined;
    actionLabel?: string | undefined;
  }>(),
  { actionLabel: "重新加载" },
);

defineEmits<{ retry: [] }>();
</script>

<template>
  <div>
    <div
      v-if="status === 'loading'"
      role="status"
      aria-live="polite"
      class="rounded-card border border-line bg-surface p-5"
    >
      <span class="sr-only">正在加载…</span>
      <p v-if="message" class="text-sm text-soft">{{ message }}</p>
      <div class="space-y-2.5" :class="message ? 'mt-3' : ''" aria-hidden="true">
        <div class="h-3 w-2/5 animate-pulse rounded-control bg-muted"></div>
        <div class="h-3 w-4/5 animate-pulse rounded-control bg-muted"></div>
        <div class="h-3 w-3/5 animate-pulse rounded-control bg-muted"></div>
      </div>
    </div>
    <div
      v-else-if="status === 'error'"
      role="alert"
      class="rounded-card border border-danger/25 p-5"
    >
      <p class="text-sm leading-6 text-danger">{{ message || "加载失败，请重试。" }}</p>
      <button
        type="button"
        class="mt-4 inline-flex min-h-9 items-center rounded-control border border-line bg-surface px-3.5 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-subtle"
        @click="$emit('retry')"
      >
        {{ actionLabel }}
      </button>
    </div>
    <div v-else class="rounded-card border border-line bg-surface p-8 text-center">
      <p class="text-sm leading-6 text-soft">{{ message || "暂无内容。" }}</p>
      <div v-if="$slots.action" class="mt-4 flex justify-center">
        <slot name="action" />
      </div>
    </div>
  </div>
</template>
