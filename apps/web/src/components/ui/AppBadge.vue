<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: "neutral" | "accent" | "success" | "warning" | "danger" | undefined;
    mono?: boolean | undefined;
  }>(),
  { tone: "neutral" },
);

const tones = {
  neutral: "border-line bg-subtle text-soft",
  accent: "border-accent/20 bg-accent-soft text-accent",
  success: "border-success/20 bg-success-soft text-success",
  warning: "border-warning/25 bg-warning-soft text-warning",
  danger: "border-danger/25 bg-danger-soft text-danger",
} as const;
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
    :class="[tones[tone], mono ? 'font-mono' : '']"
  >
    <slot />
  </span>
</template>
