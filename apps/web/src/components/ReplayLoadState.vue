<script setup lang="ts">
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";

/** Loading, failure and cancelled states of a completed match's replay. */
defineProps<{ pending: boolean; ticks: number; error: string; unsupported: boolean }>();
defineEmits<{ load: []; cancel: [] }>();
</script>

<template>
  <StateBlock
    v-if="unsupported"
    status="empty"
    message="此发行的画面尚未注册，暂时无法播放回放。"
  />
  <StateBlock
    v-else-if="pending"
    status="loading"
    :message="ticks ? `已检查 ${ticks} tick…` : '正在下载并校验回放…'"
  >
    <template #action><AppButton size="sm" @click="$emit('cancel')">取消加载</AppButton></template>
  </StateBlock>
  <StateBlock v-else-if="error" status="error" :message="error" @retry="$emit('load')" />
  <StateBlock v-else status="empty" message="回放加载已取消。"
    ><template #action
      ><AppButton variant="primary" @click="$emit('load')">加载回放</AppButton></template
    ></StateBlock
  >
</template>
