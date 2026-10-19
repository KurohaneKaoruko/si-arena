<script setup lang="ts">
defineProps<{
  caption: string;
}>();
</script>

<template>
  <div class="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
    <table class="w-full min-w-[20rem] text-left text-sm">
      <caption class="sr-only">
        {{
          caption
        }}
      </caption>
      <thead class="data-head">
        <slot name="head" />
      </thead>
      <tbody class="divide-y divide-line">
        <slot />
      </tbody>
    </table>
  </div>
</template>
