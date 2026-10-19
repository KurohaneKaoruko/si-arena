<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <section class="py-16 text-center">
    <p class="font-mono text-sm text-faint">404</p>
    <h1 class="mt-4 text-[26px] leading-tight font-semibold tracking-tight sm:text-[32px]">
      这个赛场不存在
    </h1>
    <p class="mt-3 text-sm text-soft">返回游戏大厅，选择一个新的对局起点。</p>
    <RouterLink
      class="mt-6 inline-flex min-h-10 items-center rounded-control border border-line bg-surface px-3.5 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-subtle"
      to="/"
      >返回游戏大厅</RouterLink
    >
  </section>
</template>
