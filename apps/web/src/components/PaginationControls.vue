<script setup lang="ts">
import AppButton from "./ui/AppButton.vue";

defineProps<{ page: number; limit: number; total: number; pending: boolean }>();
defineEmits<{ change: [page: number] }>();
</script>

<template>
  <nav
    v-if="total > limit"
    aria-label="分页"
    class="mt-6 flex flex-wrap items-center justify-between gap-3"
  >
    <AppButton
      variant="secondary"
      size="sm"
      :disabled="pending || page <= 1"
      @click="$emit('change', page - 1)"
      >上一页</AppButton
    >
    <span class="font-mono text-xs text-soft"
      >{{ page }} / {{ Math.max(1, Math.ceil(total / limit)) }} 页 · {{ total }} 条</span
    >
    <AppButton
      variant="secondary"
      size="sm"
      :disabled="pending || page * limit >= total"
      @click="$emit('change', page + 1)"
      >下一页</AppButton
    >
  </nav>
</template>
