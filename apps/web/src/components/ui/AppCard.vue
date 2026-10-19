<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string | undefined;
    description?: string | undefined;
    padded?: boolean | undefined;
  }>(),
  { padded: true },
);
</script>

<template>
  <section class="rounded-card border border-line bg-surface shadow-card">
    <header
      v-if="title || $slots.actions"
      class="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4"
    >
      <div class="min-w-0">
        <h2 v-if="title" class="text-[15px] font-semibold tracking-tight">{{ title }}</h2>
        <p v-if="description" class="mt-1 text-sm leading-6 text-soft">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <div :class="padded ? 'p-5' : ''">
      <slot />
    </div>
  </section>
</template>
