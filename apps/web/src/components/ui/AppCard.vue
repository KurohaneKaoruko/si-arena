<script setup lang="ts">
defineProps<{
  title?: string | undefined;
}>();
</script>

<template>
  <section class="rounded-card border border-line bg-surface shadow-card">
    <header
      v-if="title || $slots.actions"
      class="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4"
    >
      <h2 v-if="title" class="text-[15px] font-semibold tracking-tight">{{ title }}</h2>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <div class="p-5">
      <slot />
    </div>
  </section>
</template>
