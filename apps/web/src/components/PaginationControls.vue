<script setup lang="ts">
defineProps<{ page: number; limit: number; total: number; pending: boolean }>();
defineEmits<{ change: [page: number] }>();
</script>
<template>
  <nav
    v-if="total > limit"
    aria-label="分页"
    class="mt-7 flex flex-wrap items-center justify-between gap-3"
  >
    <button
      class="button-secondary"
      :disabled="pending || page <= 1"
      @click="$emit('change', page - 1)"
    >
      上一页
    </button>
    <span class="text-sm text-arena-muted"
      >{{ page }} / {{ Math.max(1, Math.ceil(total / limit)) }} 页 · {{ total }} 条</span
    >
    <button
      class="button-secondary"
      :disabled="pending || page * limit >= total"
      @click="$emit('change', page + 1)"
    >
      下一页
    </button>
  </nav>
</template>
