<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from "vue-router";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { restoreSession, session, signOut, syncSession } from "./auth/session";
import { errorMessage } from "./api/client";
import { useToast } from "./composables/useToast";
import ToastHost from "./components/ui/ToastHost.vue";
import AppButton from "./components/ui/AppButton.vue";

const route = useRoute();
const toast = useToast();
const leaving = ref(false);

onMounted(() => {
  void restoreSession();
  window.addEventListener("storage", syncSession);
});
onUnmounted(() => window.removeEventListener("storage", syncSession));

watch(
  () => session.error,
  (message) => {
    if (message) toast.error(message);
  },
);

async function logout() {
  if (leaving.value) return;
  leaving.value = true;
  try {
    await signOut();
    toast.success("已退出登录");
  } catch (failure) {
    toast.error(errorMessage(failure));
  } finally {
    leaving.value = false;
  }
}

function navClass(target: string, exact = false) {
  const active = exact ? route.path === target : route.path.startsWith(target);
  return [
    "relative inline-flex min-h-9 items-center rounded-control px-2.5 text-sm transition",
    active
      ? "font-medium text-ink after:absolute after:inset-x-2.5 after:-bottom-px after:h-px after:bg-ink"
      : "text-soft hover:text-ink",
  ];
}
</script>

<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div class="flex min-h-dvh w-full flex-col">
    <header class="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur-md">
      <div class="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-5 sm:px-8">
        <RouterLink to="/" class="flex items-center gap-2" aria-label="SI Arena 首页">
          <span
            class="flex size-7 items-center justify-center rounded-control bg-ink font-mono text-[11px] font-semibold text-white"
            aria-hidden="true"
            >SI</span
          >
          <span class="hidden text-[15px] font-semibold tracking-tight sm:inline">SI Arena</span>
        </RouterLink>
        <nav
          class="ml-auto flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="主导航"
        >
          <RouterLink :class="navClass('/', true)" to="/">游戏大厅</RouterLink>
          <RouterLink :class="navClass('/replays')" to="/replays">回放</RouterLink>
          <template v-if="session.user">
            <RouterLink :class="navClass('/account')" class="max-w-32 truncate" to="/account">{{
              session.user.username
            }}</RouterLink>
            <AppButton variant="ghost" size="sm" :loading="leaving" @click="logout">退出</AppButton>
          </template>
          <AppButton v-else-if="session.ready" variant="secondary" size="sm" to="/login"
            >登录</AppButton
          >
        </nav>
      </div>
    </header>
    <main
      id="main-content"
      class="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8 sm:py-14"
      tabindex="-1"
    >
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <footer class="border-t border-line">
      <div class="mx-auto w-full max-w-5xl px-5 py-5 sm:px-8">
        <span class="font-mono text-[11px] tracking-[0.18em] text-faint">SI ARENA</span>
      </div>
    </footer>
  </div>
  <ToastHost />
</template>
