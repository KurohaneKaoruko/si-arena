<script setup lang="ts">
import { validatePassword, validateUsername } from "@si-arena/protocol";
import { computed, onUnmounted, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { errorMessage } from "../api/client";
import { safeNextPath, session, signIn } from "../auth/session";
import { useToast } from "../composables/useToast";
import AppLogo from "../components/AppLogo.vue";
import AppButton from "../components/ui/AppButton.vue";
import AppField from "../components/ui/AppField.vue";

const props = defineProps<{ mode: "login" | "register" }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const username = ref("");
const password = ref("");
const usernameError = ref("");
const passwordError = ref("");
const pending = ref(false);
const next = computed(() => safeNextPath(route.query.next));
const register = computed(() => props.mode === "register");
let current: AbortController | undefined;

// Decorative board: two territories, their trails and heads.
const mosaic = Array.from({ length: 160 }, (_, index) => {
  const x = index % 16,
    y = Math.floor(index / 16);
  if (x === 11 && y === 3) return "var(--color-player-0)";
  if (x === 9 && y === 9) return "var(--color-player-1)";
  if (y === 3 && x >= 6 && x <= 11) return "rgb(91 140 255 / 0.85)";
  if (x === 9 && y >= 6 && y <= 8) return "rgb(255 176 32 / 0.85)";
  if (x > 9 && y > 3) return "rgb(255 176 32 / 0.38)";
  if (x < 6 && y < 6) return "rgb(91 140 255 / 0.38)";
  return "#141922";
});

watch(
  () => props.mode,
  () => {
    current?.abort();
    password.value = "";
    usernameError.value = "";
    passwordError.value = "";
    pending.value = false;
  },
);
watch(
  () => session.user,
  (user) => {
    if (user && !pending.value) void router.replace(next.value);
  },
  { immediate: true },
);
onMounted(() => {
  if (route.query.changed === "1") toast.success("密码已修改，请重新登录。");
});
async function submit() {
  if (pending.value) return;
  usernameError.value = "";
  passwordError.value = "";
  if (register.value) {
    usernameError.value = validateUsername(username.value) ?? "";
    passwordError.value = validatePassword(password.value) ?? "";
    if (usernameError.value || passwordError.value) return;
  }
  current?.abort();
  const request = new AbortController();
  current = request;
  pending.value = true;
  try {
    if (await signIn(props.mode, username.value, password.value, request.signal)) {
      password.value = "";
      await router.replace(next.value);
    }
  } catch (failure) {
    if (!request.signal.aborted) toast.error(errorMessage(failure));
  } finally {
    if (current === request) pending.value = false;
  }
}
onUnmounted(() => current?.abort());
</script>

<template>
  <div class="flex min-h-dvh w-full flex-wrap">
    <section
      class="grid-backdrop relative hidden min-h-[22.5rem] flex-[1_1_32.5rem] flex-col justify-between overflow-hidden p-10 lg:flex"
    >
      <RouterLink to="/" class="w-fit rounded-control text-ink" aria-label="SI Arena 首页"
        ><AppLogo
      /></RouterLink>
      <div class="grid grid-cols-[repeat(16,1.75rem)] gap-[3px] self-center" aria-hidden="true">
        <span
          v-for="(color, index) in mosaic"
          :key="index"
          class="size-7 rounded-[0.25rem]"
          :style="{ backgroundColor: color }"
        ></span>
      </div>
      <p class="max-w-[26rem] text-[22px] leading-[1.6] font-bold">
        写代码的是 AI，<br />站上棋盘的是你的名字。
      </p>
    </section>
    <div
      class="flex flex-[1_1_30rem] flex-col items-center justify-center gap-10 bg-surface px-6 py-12 lg:border-l lg:border-line"
    >
      <RouterLink to="/" class="rounded-control text-ink lg:hidden" aria-label="SI Arena 首页"
        ><AppLogo
      /></RouterLink>
      <form class="flex w-full max-w-[23.75rem] flex-col gap-5" @submit.prevent="submit">
        <h1 class="text-[32px] font-black">{{ register ? "创建账号" : "登录" }}</h1>
        <AppField
          v-slot="{ describedBy }"
          label="用户名"
          for-id="username"
          :error="usernameError"
          :hint="register ? '2–24 个字符，用户名不区分大小写。' : undefined"
        >
          <input
            id="username"
            v-model="username"
            class="input min-h-12"
            name="username"
            autocomplete="username"
            :aria-describedby="describedBy"
            required
            :disabled="pending"
          />
        </AppField>
        <AppField
          v-slot="{ describedBy }"
          label="密码"
          for-id="password"
          :error="passwordError"
          :hint="register ? '6–24 个字符，可使用密码管理器。' : undefined"
        >
          <input
            id="password"
            v-model="password"
            class="input min-h-12"
            name="password"
            type="password"
            :autocomplete="register ? 'new-password' : 'current-password'"
            :aria-describedby="describedBy"
            required
            :disabled="pending"
          />
        </AppField>
        <AppButton
          variant="primary"
          size="lg"
          block
          type="submit"
          class="min-h-[3.25rem] text-base"
          :loading="pending"
        >
          {{ register ? "注册并登录" : "登录" }}
        </AppButton>
        <p class="text-center text-sm text-soft">
          {{ register ? "已有账号？" : "还没有账号？" }}
          <RouterLink
            class="link inline-flex min-h-11 items-center px-1"
            :to="{ path: register ? '/login' : '/register', query: { next } }"
            >{{ register ? "登录" : "创建账号" }}</RouterLink
          >
        </p>
      </form>
    </div>
  </div>
</template>
