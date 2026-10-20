<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError, errorMessage } from "../api/client";
import { parseGameMe, parseMatch, parseUpload } from "../api/contracts";
import { authorizedRequest } from "../auth/session";
import { useApiResource } from "../composables/useApiResource";
import { useMatchRequest } from "../composables/useMatchRequest";
import AppBadge from "./ui/AppBadge.vue";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";
import { gameMatchLocation } from "../games/locations";

const props = defineProps<{ game: GameCatalogEntry; compact?: boolean }>();
const route = useRoute();
const router = useRouter();
let refreshQueued = false;
const base = computed(() => `/api/games/${encodeURIComponent(props.game.id)}`);
const {
  data,
  status,
  error,
  refreshError,
  reload,
  cancel: cancelRead,
} = useApiResource(() => `${base.value}/me`, parseGameMe, { authenticated: true, notify: false });
const active = useApiResource(
  () =>
    data.value?.activeMatch && route.query.match !== data.value.activeMatch.id
      ? `/api/matches/${encodeURIComponent(data.value.activeMatch.id)}`
      : null,
  parseMatch,
  { pollWhen: (match) => match.status === "pending" || match.status === "running", notify: false },
);
watch(
  () => active.data.value?.status,
  (value) => {
    if (value === "completed" || value === "failed") void refresh();
  },
);
const match = useMatchRequest(() => props.game.id);
watch(
  () => data.value?.activeMatch?.id,
  (id) => {
    if (id && route.path === gameMatchLocation(props.game.id).path && !route.query.match)
      void router.replace(gameMatchLocation(props.game.id, id));
  },
);
const fileInput = ref<HTMLInputElement | null>(null);
const candidate = ref<string | null>(null);
const fileError = ref("");
const feedback = ref("");
const uncertain = ref(false);
const busy = ref<"read" | "upload" | "verify" | null>(null);
const dragging = ref(false);
const working = computed(() => !!busy.value || match.pending.value);
watch([busy, match.pending, uncertain], () => {
  if (
    !working.value &&
    !uncertain.value &&
    (refreshQueued ||
      (data.value?.activeMatch &&
        (active.data.value?.status === "completed" || active.data.value?.status === "failed")))
  )
    void refresh();
});
const disabledReason = computed(
  () =>
    ({
      NO_CODE: "先上传策略",
      PROTOCOL_MISMATCH: "接口已升级，请按当前 SDK 更新策略。",
      CODE_TOO_LARGE: "当前策略超过代码大小限制，请重新上传。",
    })[data.value?.cannotMatchReason ?? "NO_CODE"],
);
let current: AbortController | undefined;
let revision = 0;

async function refresh() {
  // startMatch refreshes once its POST/navigation has finished.
  if (match.pending.value) return;
  if (busy.value || uncertain.value) {
    refreshQueued = true;
    return;
  }
  refreshQueued = false;
  await reload();
  if (data.value?.activeMatch && (active.error.value || active.refreshError.value))
    await active.reload();
}
watch(
  () => route.fullPath,
  () => void refresh(),
);
onMounted(() => window.addEventListener("focus", refresh));

function acceptUpload(source: string, metadata: ReturnType<typeof parseUpload>) {
  if (!data.value) return;
  data.value = {
    ...data.value,
    code: { ...metadata, source },
    canMatch: true,
    cannotMatchReason: null,
  };
  candidate.value = null;
  uncertain.value = false;
  fileError.value = "";
  refreshError.value = "";
  match.error.value = "";
  feedback.value = "策略已更新";
}

async function verifyUpload() {
  if (busy.value || candidate.value === null) return;
  const source = candidate.value;
  cancelRead();
  const request = new AbortController();
  current = request;
  busy.value = "verify";
  try {
    const result = await authorizedRequest(`${base.value}/me`, parseGameMe, {
      signal: request.signal,
    });
    if (request.signal.aborted) return;
    data.value = result;
    if (result.code?.source === source) acceptUpload(source, result.code);
    else fileError.value = "尚未确认上传结果，请重试上传。";
  } catch (failure) {
    if (!request.signal.aborted) fileError.value = errorMessage(failure);
  } finally {
    if (current === request) busy.value = null;
  }
}

async function upload() {
  if (candidate.value === null || working.value) return;
  const source = candidate.value;
  cancelRead();
  const request = new AbortController();
  current = request;
  busy.value = "upload";
  fileError.value = "";
  feedback.value = "";
  let verify = false;
  try {
    const result = await authorizedRequest(`${base.value}/me/code`, parseUpload, {
      method: "PUT",
      body: source,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      signal: request.signal,
    });
    if (!request.signal.aborted) acceptUpload(source, result);
  } catch (failure) {
    if (request.signal.aborted) return;
    fileError.value = errorMessage(failure);
    // A transport or server failure may happen after the new source was saved.
    if (!(failure instanceof ApiError) || failure.status >= 500) {
      uncertain.value = true;
      verify = true;
    }
  } finally {
    if (current === request) busy.value = null;
  }
  if (verify) await verifyUpload();
}

async function readFile(file: File) {
  if (working.value || uncertain.value) return;
  const version = ++revision;
  fileError.value = "";
  feedback.value = "";
  candidate.value = null;
  if (!/\.m?js$/i.test(file.name)) {
    fileError.value = "请选择 .js 或 .mjs 文件。";
    return;
  }
  if (file.size > props.game.resolvedLimits.codeBytes) {
    fileError.value = "文件超过该游戏的代码大小限制。";
    return;
  }
  busy.value = "read";
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    if (version !== revision) return;
    if (!source.trim()) fileError.value = "策略文件不能为空。";
    else candidate.value = source;
  } catch {
    if (version === revision)
      fileError.value = "无法读取文件，请使用 UTF-8 编码的 JavaScript 文件。";
  } finally {
    if (version === revision) busy.value = null;
  }
  if (version === revision && candidate.value !== null) await upload();
}

function selectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void readFile(file);
}
function dropFile(event: DragEvent) {
  dragging.value = false;
  const files = event.dataTransfer?.files;
  if (!files?.length || working.value || uncertain.value) return;
  if (files.length !== 1) {
    fileError.value = "每次只能上传一个策略文件。";
    return;
  }
  void readFile(files[0]!);
}
async function startMatch() {
  if (data.value?.canMatch && !working.value && !uncertain.value && (await match.start()))
    await refresh();
}
defineExpose({ refresh, data });
onUnmounted(() => {
  revision++;
  current?.abort();
  window.removeEventListener("focus", refresh);
});
</script>

<template>
  <StateBlock v-if="status === 'loading'" status="loading" />
  <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
  <section
    v-else-if="data"
    aria-label="我的参赛策略"
    class="min-w-0 transition"
    :class="[
      compact ? 'p-3 sm:p-4' : 'rounded-card border bg-subtle p-4',
      dragging ? 'bg-accent-soft ring-2 ring-accent/15' : 'border-line',
    ]"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="dropFile"
  >
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-soft">
      <span
        >排位 <span class="font-mono text-ink">{{ data.entry.rating.toFixed(2) }}</span> · 已赛
        {{ data.entry.matchesPlayed }} 场</span
      >
      <span class="font-mono"
        >{{ data.entry.wins }} 胜 {{ data.entry.draws }} 平 {{ data.entry.losses }} 负</span
      >
    </div>
    <div class="mb-3 flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
      <span class="text-soft">当前策略</span>
      <AppBadge v-if="uncertain" tone="warning">上传结果待确认</AppBadge>
      <AppBadge v-else-if="busy">{{
        busy === "read" ? "读取文件中" : busy === "verify" ? "核实上传结果中" : "上传并校验中"
      }}</AppBadge>
      <AppBadge v-else-if="data.canMatch" tone="success">可参赛</AppBadge>
      <AppBadge v-else :tone="data.code ? 'warning' : 'neutral'">{{
        data.code ? "需要更新" : "尚未上传"
      }}</AppBadge>
      <span v-if="data.code" class="font-mono text-soft"
        >{{ (data.code.sourceBytes / 1024).toFixed(1) }} KiB</span
      >
      <span v-if="feedback && !busy" class="text-success">{{ feedback }}</span>
      <span v-if="dragging" class="text-accent">松开以上传策略</span>
    </div>
    <p v-if="!data.canMatch" class="mb-3 text-xs text-soft">{{ disabledReason }}</p>
    <div class="flex flex-wrap gap-2">
      <input
        ref="fileInput"
        id="strategy-file"
        class="sr-only"
        type="file"
        accept=".js,.mjs,text/javascript,application/javascript"
        tabindex="-1"
        aria-label="上传策略文件"
        :disabled="working || uncertain"
        @change="selectFile"
      />
      <AppButton
        class="flex-1"
        :variant="data.code ? 'secondary' : 'primary'"
        :loading="!!busy"
        :disabled="working || uncertain"
        @click="fileInput?.click()"
        >{{ data.code ? "更新策略" : "上传策略" }}</AppButton
      >
      <AppButton
        v-if="data.activeMatch"
        class="flex-1"
        variant="primary"
        :disabled="working || uncertain"
        :to="gameMatchLocation(game.id, data.activeMatch.id)"
        >查看当前比赛</AppButton
      >
      <AppButton
        v-else
        class="flex-1"
        :variant="data.code ? 'primary' : 'secondary'"
        :loading="match.pending.value"
        :disabled="!data.canMatch || working || uncertain"
        @click="startMatch"
        >发起匹配</AppButton
      >
    </div>
    <div
      v-if="fileError || uncertain"
      class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3"
    >
      <p role="alert" class="min-w-0 break-words text-sm text-danger">
        {{ fileError || "正在确认上传结果。" }}
      </p>
      <AppButton v-if="uncertain" size="sm" :disabled="working" @click="verifyUpload"
        >核实状态</AppButton
      >
      <AppButton v-if="candidate !== null" size="sm" :disabled="working" @click="upload"
        >重试上传</AppButton
      >
    </div>
    <div
      v-if="refreshError || active.refreshError.value || active.error.value"
      class="mt-3 flex flex-wrap items-center gap-3 text-xs text-danger"
      role="alert"
    >
      {{ refreshError || active.refreshError.value || active.error.value }}
      <AppButton size="sm" variant="link" :disabled="working" @click="refresh"
        >刷新参赛状态</AppButton
      >
    </div>
    <p v-if="match.error.value" role="alert" class="mt-3 text-sm text-danger">
      {{ match.error.value }}
    </p>
    <details v-if="data.code && !compact" class="mt-3 border-t border-line pt-2">
      <summary class="w-fit cursor-pointer py-1 text-xs text-soft">查看当前代码</summary>
      <pre class="code-block mt-2 max-h-80">{{ data.code.source }}</pre>
    </details>
  </section>
</template>
