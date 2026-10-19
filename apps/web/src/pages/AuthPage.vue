<script setup lang="ts">
import { validatePassword, validateUsername } from "@si-arena/protocol";
import { computed, onUnmounted, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { errorMessage } from "../api/client";
import { safeNextPath, session, signIn } from "../auth/session";
import { useToast } from "../composables/useToast";
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
  <section class="mx-auto max-w-sm">
    <h1 class="text-[26px] leading-tight font-semibold tracking-tight sm:text-[32px]">
      {{ register ? "创建账号" : "欢迎回来" }}
    </h1>
    <p class="lead mt-3">
      {{ register ? "上传策略，让你的代码加入赛场。" : "继续改进策略，开始下一场对决。" }}
    </p>
    <form class="mt-8 space-y-5" @submit.prevent="submit">
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
          class="input"
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
          class="input"
          name="password"
          type="password"
          :autocomplete="register ? 'new-password' : 'current-password'"
          :aria-describedby="describedBy"
          required
          :disabled="pending"
        />
      </AppField>
      <AppButton variant="primary" size="lg" block type="submit" :loading="pending">
        {{ register ? "注册并登录" : "登录" }}
      </AppButton>
    </form>
    <p class="mt-6 text-sm text-soft">
      {{ register ? "已有账号？" : "还没有账号？" }}
      <RouterLink class="link" :to="{ path: register ? '/login' : '/register', query: { next } }">{{
        register ? "登录" : "创建账号"
      }}</RouterLink>
    </p>
  </section>
</template>
