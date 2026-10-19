<script setup lang="ts">
import { validatePassword } from "@si-arena/protocol";
import { onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { errorMessage } from "../api/client";
import { changePassword, session } from "../auth/session";
import AccountGate from "../components/AccountGate.vue";
const oldPassword = ref("");
const newPassword = ref("");
const error = ref("");
const pending = ref(false);
const router = useRouter();
let current: AbortController | undefined;
watch(
  () => session.user?.id,
  () => {
    oldPassword.value = "";
    newPassword.value = "";
    error.value = "";
  },
);
async function submit() {
  if (pending.value) return;
  error.value = validatePassword(newPassword.value) ?? "";
  if (error.value) return;
  const request = new AbortController();
  current = request;
  pending.value = true;
  const owner = session.user?.id;
  try {
    const changed = await changePassword(oldPassword.value, newPassword.value, request.signal);
    oldPassword.value = "";
    newPassword.value = "";
    if (changed && !request.signal.aborted) await router.replace("/login?changed=1");
  } catch (failure) {
    if (!request.signal.aborted && owner === session.user?.id) error.value = errorMessage(failure);
  } finally {
    pending.value = false;
  }
}
onUnmounted(() => current?.abort());
</script>
<template>
  <section class="mx-auto max-w-md">
    <h1 class="text-3xl font-semibold">账号设置</h1>
    <div class="mt-8">
      <AccountGate
        ><form class="panel space-y-6 p-7" @submit.prevent="submit">
          <p class="break-all text-arena-muted">{{ session.user?.username }}</p>
          <h2 class="text-xl font-semibold">修改密码</h2>
          <p class="text-sm leading-6 text-arena-muted">修改成功后，所有设备都需要重新登录。</p>
          <input
            class="sr-only"
            :value="session.user?.username"
            name="username"
            autocomplete="username"
            tabindex="-1"
            readonly
            aria-label="用户名"
          />
          <label class="block"
            >当前密码<input
              v-model="oldPassword"
              class="field-input mt-2"
              type="password"
              autocomplete="current-password"
              required
              :disabled="pending"
          /></label>
          <label class="block"
            >新密码<input
              v-model="newPassword"
              class="field-input mt-2"
              type="password"
              autocomplete="new-password"
              required
              :disabled="pending"
            /><span class="mt-2 block text-xs text-arena-muted">6–24 个字符</span></label
          >
          <p v-if="error" role="alert" class="text-sm text-arena-danger">{{ error }}</p>
          <button class="button-primary" :disabled="pending">
            {{ pending ? "正在修改…" : "修改密码" }}
          </button>
        </form></AccountGate
      >
    </div>
  </section>
</template>
