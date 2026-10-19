<script setup lang="ts">
import { validatePassword } from "@si-arena/protocol";
import { onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { errorMessage } from "../api/client";
import { changePassword, session } from "../auth/session";
import { useToast } from "../composables/useToast";
import AccountGate from "../components/AccountGate.vue";
import AppButton from "../components/ui/AppButton.vue";
import AppField from "../components/ui/AppField.vue";

const oldPassword = ref("");
const newPassword = ref("");
const passwordError = ref("");
const pending = ref(false);
const router = useRouter();
const toast = useToast();
let current: AbortController | undefined;

watch(
  () => session.user?.id,
  () => {
    oldPassword.value = "";
    newPassword.value = "";
    passwordError.value = "";
  },
);
async function submit() {
  if (pending.value) return;
  passwordError.value = validatePassword(newPassword.value) ?? "";
  if (passwordError.value) return;
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
    if (!request.signal.aborted && owner === session.user?.id) toast.error(errorMessage(failure));
  } finally {
    pending.value = false;
  }
}
onUnmounted(() => current?.abort());
</script>

<template>
  <section class="mx-auto max-w-sm">
    <h1 class="text-[26px] leading-tight font-semibold tracking-tight sm:text-[32px]">账号设置</h1>
    <div class="mt-8">
      <AccountGate>
        <form class="space-y-5" @submit.prevent="submit">
          <p class="break-all font-mono text-sm text-soft">{{ session.user?.username }}</p>
          <input
            class="sr-only"
            :value="session.user?.username"
            name="username"
            autocomplete="username"
            tabindex="-1"
            readonly
            aria-label="用户名"
          />
          <AppField label="当前密码" for-id="current-password">
            <input
              id="current-password"
              v-model="oldPassword"
              class="input"
              type="password"
              autocomplete="current-password"
              required
              :disabled="pending"
            />
          </AppField>
          <AppField label="新密码" for-id="new-password" :error="passwordError" hint="6–24 个字符">
            <input
              id="new-password"
              v-model="newPassword"
              class="input"
              type="password"
              autocomplete="new-password"
              required
              :disabled="pending"
            />
          </AppField>
          <p class="text-xs leading-5 text-soft">修改成功后，所有设备都需要重新登录。</p>
          <AppButton variant="primary" size="lg" type="submit" :loading="pending">
            修改密码
          </AppButton>
        </form>
      </AccountGate>
    </div>
  </section>
</template>
