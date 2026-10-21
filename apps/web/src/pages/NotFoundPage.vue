<script setup lang="ts">
import AppButton from "../components/ui/AppButton.vue";
</script>

<template>
  <section class="flex flex-col items-center gap-4 py-16 text-center">
    <p class="figure text-5xl text-accent">404</p>
    <h1 class="text-[28px] leading-tight font-black sm:text-[32px]">这个赛场不存在</h1>
    <p class="text-sm text-soft">返回大厅，选择一个新的对局起点。</p>
    <AppButton variant="primary" class="mt-2" to="/">返回大厅</AppButton>
  </section>
</template>
