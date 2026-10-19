<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";
import { session, restoreSession } from "../auth/session";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";

const route = useRoute();
</script>

<template>
  <StateBlock v-if="!session.ready" status="loading" />
  <StateBlock
    v-else-if="session.error"
    status="error"
    :message="session.error"
    action-label="重新连接"
    @retry="restoreSession"
  />
  <div v-else-if="!session.user" class="rounded-card border border-line bg-subtle p-6 text-center">
    <p class="text-sm leading-6 text-soft">登录后上传策略、发起比赛并查看战绩。</p>
    <AppButton
      class="mt-4"
      variant="primary"
      :to="{ path: '/login', query: { next: route.fullPath } }"
      >登录参赛</AppButton
    >
  </div>
  <slot v-else :key="session.user.id" />
</template>
