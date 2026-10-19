<script setup lang="ts">
defineProps<{
  title: string;
  description?: string | undefined;
  label?: string | undefined;
}>();
</script>

<template>
  <header>
    <p v-if="label" class="meta">{{ label }}</p>
    <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div class="min-w-0">
        <h1
          class="text-[26px] leading-tight font-semibold tracking-tight text-balance sm:text-[32px]"
        >
          {{ title }}
        </h1>
        <p v-if="description" class="lead mt-3 max-w-2xl">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </header>
</template>
