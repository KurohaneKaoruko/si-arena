<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
import { onMounted, onUnmounted, ref } from "vue";
import { restoreSession, session, signOut, syncSession } from "./auth/session";
import { errorMessage } from "./api/client";
const leaving = ref(false);
const error = ref("");
onMounted(() => {
  void restoreSession();
  window.addEventListener("storage", syncSession);
});
onUnmounted(() => window.removeEventListener("storage", syncSession));
async function logout() {
  leaving.value = true;
  error.value = "";
  try {
    await signOut();
  } catch (failure) {
    error.value = errorMessage(failure);
  } finally {
    leaving.value = false;
  }
}
</script>

<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div class="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 sm:px-8">
    <header
      class="flex min-h-24 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-arena-border py-4"
    >
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
      <nav class="flex flex-wrap items-center gap-1" aria-label="主导航">
        <RouterLink
          class="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-arena-muted transition-colors hover:bg-arena-card hover:text-arena-text"
          to="/replays"
          >回放</RouterLink
        >
        <RouterLink
          class="inline-flex min-h-11 items-center rounded-lg px-4 text-sm text-arena-muted transition-colors hover:bg-arena-card hover:text-arena-text"
          to="/"
          >游戏大厅</RouterLink
        >
        <template v-if="session.user">
          <RouterLink
            class="inline-flex min-h-11 max-w-40 items-center rounded-lg px-3 text-sm text-arena-accent"
            to="/account"
            ><span class="truncate">{{ session.user.username }}</span></RouterLink
          >
          <button
            class="min-h-11 px-3 text-sm text-arena-muted hover:text-arena-text disabled:opacity-40"
            :disabled="leaving"
            @click="logout"
          >
            {{ leaving ? "退出中…" : "退出" }}
          </button>
        </template>
        <RouterLink v-else-if="session.ready" class="button-secondary" to="/login">登录</RouterLink>
      </nav>
    </header>
    <div v-if="session.error || error" role="alert" class="mt-4 text-sm text-arena-danger">
      <p>{{ error || session.error }}</p>
      <button v-if="session.error" class="button-secondary mt-2" @click="restoreSession">
        恢复登录
      </button>
    </div>
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
