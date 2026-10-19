<script setup lang="ts">
import { computed, useId } from "vue";

const props = defineProps<{
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  forId?: string | undefined;
}>();

const uid = useId();
const hintId = computed(() => `${props.forId ?? uid}-hint`);
/** 提示真正渲染出来时才提供 id，避免 aria-describedby 指向不存在的元素。 */
const describedBy = computed(() => (props.hint && !props.error ? hintId.value : undefined));
</script>

<template>
  <div>
    <label v-if="label" class="field-label" :for="forId">{{ label }}</label>
    <div :class="label ? 'mt-1.5' : ''">
      <slot :described-by="describedBy" />
    </div>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="field-hint" :id="hintId">{{ hint }}</p>
  </div>
</template>
