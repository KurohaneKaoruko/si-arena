<script setup lang="ts">
defineProps<{
  items: readonly { label: string; value: string }[];
}>();
</script>

<template>
  <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div
      v-for="item in items"
      :key="item.label"
      class="rounded-card border border-line bg-surface px-4 py-3.5"
    >
      <dt class="text-xs text-soft">{{ item.label }}</dt>
      <dd class="mt-1 font-mono text-lg tracking-tight text-ink">{{ item.value }}</dd>
    </div>
  </dl>
</template>
