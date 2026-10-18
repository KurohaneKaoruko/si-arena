<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="py-12 text-center">
    <p class="font-mono text-sm text-arena-accent">404</p>
    <h1 class="mt-5 text-3xl font-semibold">这个赛场不存在</h1>
    <p class="mt-4 text-arena-muted">返回游戏大厅，选择一个新的对局起点。</p>
    <RouterLink class="button-secondary mt-8" to="/">返回游戏大厅</RouterLink>
  </section>
</template>
