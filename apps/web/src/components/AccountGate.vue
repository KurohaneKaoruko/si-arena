<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";
import { session, restoreSession } from "../auth/session";
const route = useRoute();
</script>
<template>
  <p v-if="!session.ready" role="status" class="panel p-7 text-arena-muted">正在恢复登录状态…</p>
  <div v-else-if="session.error" role="alert" class="panel p-7">
    <p class="text-arena-danger">{{ session.error }}</p>
    <button class="button-secondary mt-4" @click="restoreSession">重新连接</button>
  </div>
  <div v-else-if="!session.user" class="panel p-7">
    <p class="text-arena-muted">登录后上传策略、发起比赛并查看自己的战绩。</p>
    <RouterLink
      class="button-primary mt-5"
      :to="{ path: '/login', query: { next: route.fullPath } }"
      >登录参赛</RouterLink
    >
  </div>
  <slot v-else :key="session.user.id" />
</template>
