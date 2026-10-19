<script setup lang="ts">
import { validatePassword, validateUsername } from "@si-arena/protocol";
import { computed, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { errorMessage } from "../api/client";
import { safeNextPath, session, signIn } from "../auth/session";

const props = defineProps<{ mode: "login" | "register" }>();
const route = useRoute();
const router = useRouter();
const username = ref("");
const password = ref("");
const pending = ref(false);
const error = ref("");
const next = computed(() => safeNextPath(route.query.next));
const register = computed(() => props.mode === "register");
let current: AbortController | undefined;
watch(
  () => props.mode,
  () => {
    current?.abort();
    password.value = "";
    error.value = "";
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
async function submit() {
  if (pending.value) return;
  error.value = "";
  if (register.value) {
    const invalid = validateUsername(username.value) ?? validatePassword(password.value);
    if (invalid) {
      error.value = invalid;
      return;
    }
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
    if (!request.signal.aborted) error.value = errorMessage(failure);
  } finally {
    if (current === request) pending.value = false;
  }
}
onUnmounted(() => current?.abort());
</script>

<template>
  <section class="mx-auto max-w-md">
    <p class="eyebrow">YOUR NEXT MOVE</p>
    <h1 class="mt-4 text-3xl font-semibold">{{ register ? "创建账号" : "欢迎回来" }}</h1>
    <p class="mt-3 leading-7 text-arena-muted">
      {{ register ? "上传策略，让你的代码加入赛场。" : "继续改进策略，开始下一场对决。" }}
    </p>
    <p v-if="route.query.changed === '1'" role="status" class="mt-6 text-arena-accent">
      密码已修改，请重新登录。
    </p>
    <form class="panel mt-8 space-y-6 p-6 sm:p-8" @submit.prevent="submit">
      <label class="block"
        >用户名<input
          v-model="username"
          class="field-input mt-2"
          name="username"
          autocomplete="username"
          required
          :disabled="pending"
        /><span v-if="register" class="mt-2 block text-xs text-arena-muted"
          >2–24 个字符，用户名不区分大小写。</span
        ></label
      >
      <label class="block"
        >密码<input
          v-model="password"
          class="field-input mt-2"
          name="password"
          type="password"
          :autocomplete="register ? 'new-password' : 'current-password'"
          required
          :disabled="pending"
        /><span v-if="register" class="mt-2 block text-xs text-arena-muted"
          >6–24 个字符，可使用密码管理器。</span
        ></label
      >
      <p v-if="error" role="alert" class="text-sm leading-6 text-arena-danger">{{ error }}</p>
      <button class="button-primary w-full" :disabled="pending" type="submit">
        {{ pending ? "正在提交…" : register ? "注册并登录" : "登录" }}
      </button>
    </form>
    <p class="mt-6 text-sm text-arena-muted">
      {{ register ? "已有账号？" : "还没有账号？" }}
      <RouterLink
        class="text-arena-accent underline underline-offset-4"
        :to="{ path: register ? '/login' : '/register', query: { next } }"
        >{{ register ? "登录" : "创建账号" }}</RouterLink
      >
    </p>
  </section>
</template>
