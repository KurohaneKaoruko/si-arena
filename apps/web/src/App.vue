<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
</script>

<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div class="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 sm:px-8">
    <header class="flex min-h-24 items-center justify-between gap-5 border-b border-arena-border">
      <RouterLink
        to="/"
        class="inline-flex min-h-11 items-center gap-3 font-semibold tracking-tight"
        aria-label="SI Arena 首页"
      >
        <span
          class="flex size-10 items-center justify-center rounded-xl border border-arena-accent/30 bg-arena-accent/10 font-mono text-sm text-arena-accent"
          aria-hidden="true"
          >SI</span
        >
        <span class="text-xl">SI Arena</span>
      </RouterLink>
      <nav aria-label="主导航">
        <RouterLink
          class="inline-flex min-h-11 items-center rounded-lg px-4 text-sm text-arena-muted transition-colors hover:bg-arena-card hover:text-arena-text"
          to="/"
          >游戏大厅</RouterLink
        >
      </nav>
    </header>
    <main id="main-content" class="flex-1 py-14 sm:py-20" tabindex="-1">
      <RouterView />
    </main>
    <footer
      class="flex flex-wrap justify-between gap-3 border-t border-arena-border py-7 font-mono text-xs text-arena-muted"
    >
      <span>SI / SUPER INTELLIGENCE</span>
      <span>让策略代码上场。</span>
    </footer>
  </div>
</template>
