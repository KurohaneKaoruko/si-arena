<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, errorMessage } from "../api/client";
import { parseGameMe, parseMatch, parseUpload } from "../api/contracts";
import { authorizedRequest } from "../auth/session";
import { useApiResource } from "../composables/useApiResource";

const props = defineProps<{ game: GameCatalogEntry }>();
const router = useRouter();
const base = computed(() => `/api/games/${encodeURIComponent(props.game.id)}`);
const { data, pending, error, reload } = useApiResource(() => `${base.value}/me`, parseGameMe, {
  authenticated: true,
});
const source = ref<string | null>(null);
const fileName = ref("");
const fileError = ref("");
const feedback = ref("");
const actionError = ref("");
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
  feedback.value = "";
  actionError.value = "";
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
  actionError.value = "";
  feedback.value = "";
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
    feedback.value = "最新代码已保存，发起匹配后开始比赛。";
    await reload();
  } catch (failure) {
    if (!request.signal.aborted) actionError.value = errorMessage(failure);
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
  actionError.value = "";
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
    actionError.value = errorMessage(failure);
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
  <p v-if="pending && !data" role="status" class="text-arena-muted">正在加载参赛信息…</p>
  <div v-if="error" role="alert">
    <p class="text-arena-danger">{{ error }}</p>
    <button class="button-secondary mt-3" @click="reload">重新加载</button>
  </div>
  <template v-if="data">
    <dl class="grid grid-cols-3 gap-4 border-b border-arena-border pb-6">
      <div>
        <dt class="text-sm text-arena-muted">排位分</dt>
        <dd class="mt-2 font-mono text-2xl">{{ data.entry.rating.toFixed(1) }}</dd>
      </div>
      <div>
        <dt class="text-sm text-arena-muted">已赛</dt>
        <dd class="mt-2 font-mono text-2xl">{{ data.entry.matchesPlayed }}</dd>
      </div>
      <div>
        <dt class="text-sm text-arena-muted">胜 / 平 / 负</dt>
        <dd class="mt-3 font-mono text-sm">
          {{ data.entry.wins }} / {{ data.entry.draws }} / {{ data.entry.losses }}
        </dd>
      </div>
    </dl>
    <div class="mt-6 grid gap-8 md:grid-cols-2">
      <div class="min-w-0">
        <h3 class="font-semibold">上传策略</h3>
        <p class="mt-2 text-sm leading-7 text-arena-muted">
          选择 UTF-8 编码的 .js 文件，最大
          {{ Math.floor(game.resolvedLimits.codeBytes / 1024) }}
          KiB。上传会替换当前代码，进行中的比赛不受影响。
        </p>
        <label class="mt-4 block text-sm"
          >JavaScript 文件<input
            class="mt-2 block w-full min-w-0 text-sm text-arena-muted file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-arena-border file:bg-arena-background file:px-3 file:text-arena-text"
            type="file"
            accept=".js,.mjs,text/javascript,application/javascript"
            :disabled="!!busy"
            @change="selectFile"
        /></label>
        <p v-if="fileName" class="mt-3 break-all text-xs text-arena-muted">
          待上传：{{ fileName }}
        </p>
        <p v-if="fileError" role="alert" class="mt-3 text-sm text-arena-danger">{{ fileError }}</p>
        <button class="button-secondary mt-4" :disabled="source === null || !!busy" @click="upload">
          {{ busy === "upload" ? "正在上传…" : "上传并替换" }}
        </button>
      </div>
      <div>
        <h3 class="font-semibold">开始排位</h3>
        <p class="mt-2 text-sm leading-7 text-arena-muted">
          主动发起一场比赛，系统将匹配实力接近的对手。代码上传后，即使你离线也能被其他玩家匹配。
        </p>
        <p v-if="!data.canMatch" class="mt-3 text-sm text-arena-muted">{{ disabledReason }}</p>
        <button class="button-primary mt-4" :disabled="!data.canMatch || !!busy" @click="match">
          {{ busy === "match" ? "正在匹配…" : "发起匹配" }}
        </button>
      </div>
    </div>
    <p v-if="feedback" role="status" class="mt-6 text-sm text-arena-accent">{{ feedback }}</p>
    <p v-if="actionError" role="alert" class="mt-6 text-sm text-arena-danger">{{ actionError }}</p>
    <details v-if="data.code" class="mt-7 border-t border-arena-border pt-5">
      <summary class="cursor-pointer text-sm text-arena-muted">
        查看已上传代码 · {{ data.code.sourceBytes }} 字节 ·
        {{ new Date(data.code.updatedAt).toLocaleString("zh-CN") }}
      </summary>
      <pre
        class="mt-4 max-h-80 overflow-auto rounded-lg bg-arena-background p-4 font-mono text-xs leading-6"
        >{{ data.code.source }}</pre>
    </details>
  </template>
</template>
