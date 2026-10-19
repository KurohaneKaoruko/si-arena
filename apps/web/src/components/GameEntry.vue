<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, errorMessage } from "../api/client";
import { parseGameMe, parseMatch, parseUpload } from "../api/contracts";
import { authorizedRequest } from "../auth/session";
import { useApiResource } from "../composables/useApiResource";
import { useToast } from "../composables/useToast";
import AppButton from "./ui/AppButton.vue";
import AppField from "./ui/AppField.vue";
import StateBlock from "./ui/StateBlock.vue";

const props = defineProps<{ game: GameCatalogEntry }>();
const router = useRouter();
const toast = useToast();
const base = computed(() => `/api/games/${encodeURIComponent(props.game.id)}`);
const { data, status, error, reload } = useApiResource(() => `${base.value}/me`, parseGameMe, {
  authenticated: true,
});
const source = ref<string | null>(null);
const fileName = ref("");
const fileError = ref("");
const busy = ref<"upload" | "match" | "read" | null>(null);
const disabledReason = computed(
  () =>
    ({
      NO_CODE: "先上传 JavaScript 代码，即可开始匹配。",
      PROTOCOL_MISMATCH: "游戏接口已升级，请根据当前 SDK 重新上传代码。",
      CODE_TOO_LARGE: "当前代码超过了游戏限额，请调整后重新上传。",
    })[data.value?.cannotMatchReason ?? "NO_CODE"],
);
let current: AbortController | undefined;
let fileRevision = 0;
let key: string | null = null;

async function selectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const version = ++fileRevision;
  source.value = null;
  fileName.value = "";
  fileError.value = "";
  if (!file) return;
  if (file.size > props.game.resolvedLimits.codeBytes) {
    fileError.value = "文件超过该游戏的代码大小限制。";
    return;
  }
  busy.value = "read";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    if (version === fileRevision) {
      source.value = text;
      fileName.value = file.name;
    }
  } catch {
    if (version === fileRevision)
      fileError.value = "无法读取文件，请使用 UTF-8 编码的 JavaScript 文件。";
  } finally {
    if (version === fileRevision) busy.value = null;
  }
}

async function upload() {
  if (source.value === null || busy.value) return;
  const request = new AbortController();
  current = request;
  busy.value = "upload";
  try {
    await authorizedRequest(`${base.value}/me/code`, parseUpload, {
      method: "PUT",
      body: source.value,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      signal: request.signal,
    });
    if (request.signal.aborted) return;
    source.value = null;
    fileName.value = "";
    toast.success("最新代码已保存，发起匹配后开始比赛。");
    await reload();
  } catch (failure) {
    if (!request.signal.aborted) toast.error(errorMessage(failure));
  } finally {
    if (current === request) busy.value = null;
  }
}

async function match() {
  if (!data.value?.canMatch || busy.value) return;
  key ??= crypto.randomUUID();
  const request = new AbortController();
  current = request;
  busy.value = "match";
  try {
    const result = await authorizedRequest(`${base.value}/matches`, parseMatch, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      signal: request.signal,
    });
    key = null;
    if (!request.signal.aborted) await router.push(`/matches/${encodeURIComponent(result.id)}`);
  } catch (failure) {
    if (request.signal.aborted) return;
    if (
      failure instanceof ApiError &&
      failure.code === "MATCH_ALREADY_PENDING" &&
      failure.matchId
    ) {
      key = null;
      await router.push(`/matches/${encodeURIComponent(failure.matchId)}`);
      return;
    }
    if (failure instanceof ApiError && failure.status < 500) key = null;
    toast.error(errorMessage(failure));
  } finally {
    if (current === request) busy.value = null;
  }
}

onUnmounted(() => {
  fileRevision++;
  current?.abort();
});
</script>

<template>
  <StateBlock v-if="status === 'loading'" status="loading" />
  <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
  <div v-else-if="data">
    <dl class="grid grid-cols-3 gap-px overflow-hidden rounded-card border border-line bg-line">
      <div class="bg-surface px-4 py-3">
        <dt class="text-xs text-soft">排位分</dt>
        <dd class="mt-1 font-mono text-lg tracking-tight">{{ data.entry.rating.toFixed(2) }}</dd>
      </div>
      <div class="bg-surface px-4 py-3">
        <dt class="text-xs text-soft">已赛</dt>
        <dd class="mt-1 font-mono text-lg tracking-tight">{{ data.entry.matchesPlayed }}</dd>
      </div>
      <div class="bg-surface px-4 py-3">
        <dt class="text-xs text-soft">胜 / 平 / 负</dt>
        <dd class="mt-1 font-mono text-sm tracking-tight">
          {{ data.entry.wins }} / {{ data.entry.draws }} / {{ data.entry.losses }}
        </dd>
      </div>
    </dl>

    <div class="mt-6 grid gap-8 md:grid-cols-2">
      <div class="min-w-0">
        <h3 class="text-sm font-semibold">上传策略</h3>
        <p class="mt-1.5 text-sm leading-6 text-soft">
          选择 UTF-8 编码的 .js 文件，最大 {{ Math.floor(game.resolvedLimits.codeBytes / 1024) }}
          KiB。上传会替换当前代码。
        </p>
        <AppField class="mt-4" :error="fileError" for-id="strategy-file">
          <label
            for="strategy-file"
            class="flex min-h-10 cursor-pointer items-center justify-center rounded-control border border-line bg-surface px-3.5 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-subtle"
          >
            选择 .js 文件
          </label>
          <input
            id="strategy-file"
            class="sr-only"
            type="file"
            accept=".js,.mjs,text/javascript,application/javascript"
            :disabled="!!busy"
            @change="selectFile"
          />
        </AppField>
        <p v-if="fileName" class="mt-2 break-all font-mono text-xs text-faint">
          待上传：{{ fileName }}
        </p>
        <AppButton
          class="mt-4"
          variant="secondary"
          :loading="busy === 'upload'"
          :disabled="source === null || !!busy"
          @click="upload"
          >上传并替换</AppButton
        >
      </div>
      <div>
        <h3 class="text-sm font-semibold">开始排位</h3>
        <p class="mt-1.5 text-sm leading-6 text-soft">
          主动发起一场比赛，系统匹配实力接近的对手。你离线时对手仍能匹配到你。
        </p>
        <p v-if="!data.canMatch" class="mt-3 text-sm leading-6 text-soft">{{ disabledReason }}</p>
        <AppButton
          class="mt-4"
          variant="primary"
          :loading="busy === 'match'"
          :disabled="!data.canMatch || !!busy"
          @click="match"
          >发起匹配</AppButton
        >
      </div>
    </div>

    <details v-if="data.code" class="mt-7 border-t border-line pt-4">
      <summary class="cursor-pointer text-sm text-soft transition hover:text-ink">
        已上传代码 · {{ data.code.sourceBytes }} 字节 ·
        {{ new Date(data.code.updatedAt).toLocaleString("zh-CN") }}
      </summary>
      <pre class="code-block mt-3 max-h-80">{{ data.code.source }}</pre>
    </details>
  </div>
</template>
