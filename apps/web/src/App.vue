<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from "vue-router";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { restoreSession, session, signOut, syncSession } from "./auth/session";
import { errorMessage } from "./api/client";
import { useToast } from "./composables/useToast";
import ToastHost from "./components/ui/ToastHost.vue";
import AppButton from "./components/ui/AppButton.vue";

const route = useRoute();
const gameWorkspace = computed(() => !!route.params.gameId);
const toast = useToast();
const leaving = ref(false);

onMounted(() => {
  void restoreSession();
  window.addEventListener("storage", syncSession);
});
onUnmounted(() => window.removeEventListener("storage", syncSession));

function retrySession() {
  void restoreSession();
}
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
    "touch-target relative inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-control px-2 text-sm transition sm:px-2.5",
    active
      ? "font-medium text-ink after:absolute after:inset-x-2.5 after:-bottom-px after:h-px after:bg-ink"
      : "text-soft hover:text-ink",
  ];
}
</script>

<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div
    class="app-shell flex min-h-dvh w-full flex-col"
    :class="{ 'app-shell--game': gameWorkspace }"
  >
    <header
      class="sticky top-0 z-40 shrink-0 border-b border-line bg-background/85 backdrop-blur-md"
    >
      <div class="workspace flex h-14 items-center gap-3">
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
          <RouterLink :class="navClass('/replays')" to="/replays">本地回放</RouterLink>
          <template v-if="session.user">
            <RouterLink :class="navClass('/account')" class="max-w-16 sm:max-w-32" to="/account"
              ><span class="truncate">{{ session.user.username }}</span></RouterLink
            >
            <AppButton variant="ghost" size="sm" :loading="leaving" @click="logout">退出</AppButton>
          </template>
          <AppButton v-else-if="session.ready" variant="secondary" size="sm" to="/login"
            >登录</AppButton
          >
        </nav>
      </div>
    </header>
    <div
      v-if="session.error"
      role="alert"
      class="shrink-0 border-b border-danger/25 bg-danger-soft"
    >
      <div class="workspace flex flex-wrap items-center justify-between gap-3 py-2.5">
        <p class="text-sm text-danger">{{ session.error }}</p>
        <AppButton size="sm" variant="secondary" @click="retrySession">恢复登录</AppButton>
      </div>
    </div>
    <main id="main-content" class="workspace flex-1 py-6 sm:py-7" tabindex="-1">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
  </div>
  <ToastHost />
</template>
