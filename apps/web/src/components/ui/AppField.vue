<script setup lang="ts">
defineProps<{
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  forId?: string | undefined;
}>();
</script>

<template>
  <div>
    <label v-if="label" class="field-label" :for="forId">{{ label }}</label>
    <div :class="label ? 'mt-1.5' : ''">
      <slot />
    </div>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>
