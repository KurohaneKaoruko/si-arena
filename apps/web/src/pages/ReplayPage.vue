<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import {
  loadRegisteredReplay,
  readBrowserReplay,
  type BrowserReplaySession,
} from "@si-arena/player/browser";
import { replayGames } from "../games/replays";
import ReplayViewer from "../components/ReplayViewer.vue";

const session = shallowRef<BrowserReplaySession | null>(null);
const pending = ref(false),
  error = ref(""),
  fileName = ref(""),
  completed = ref(0);
let loading: AbortController | undefined;
const progress = computed(() =>
  completed.value ? `已检查 ${completed.value} tick…` : "正在解压并校验回放…",
);
async function selectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  loading?.abort();
  const controller = new AbortController();
  loading = controller;
  session.value = null;
  error.value = "";
  completed.value = 0;
  pending.value = true;
  fileName.value = file.name;
  try {
    const raw = await readBrowserReplay(file, controller.signal);
    const loaded = await loadRegisteredReplay(raw, replayGames, {
      signal: controller.signal,
      onProgress: (ticks) => {
        if (loading === controller) completed.value = ticks;
      },
      yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
    });
    if (loading === controller && !controller.signal.aborted) session.value = loaded;
  } catch (cause) {
    if (loading === controller && !controller.signal.aborted)
      error.value = `无法播放这份回放：${cause instanceof Error ? cause.message : "文件读取失败"}`;
  } finally {
    if (loading === controller) pending.value = false;
  }
}
function cancelLoad() {
  loading?.abort();
  pending.value = false;
}
onBeforeUnmount(() => loading?.abort());
</script>

<template>
  <section aria-labelledby="replay-title">
    <div class="flex flex-wrap items-end justify-between gap-6">
      <div class="min-w-0">
        <p class="mb-3 font-mono text-xs tracking-[0.2em] text-arena-accent">REPLAY / 赛场回看</p>
        <h1
          id="replay-title"
          class="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          让每一步策略，都看得见。
        </h1>
        <p class="mt-4 max-w-2xl leading-7 text-arena-muted">
          打开本地比赛回放，重看圈地路线，定位日志与错误。文件只在浏览器中读取。
        </p>
      </div>
      <label
        class="button-secondary relative shrink-0 overflow-hidden focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-arena-accent"
      >
        打开回放文件
        <input
          class="absolute inset-0 cursor-pointer opacity-0"
          type="file"
          accept=".gz,.json.gz,application/gzip"
          aria-label="打开回放文件"
          @change="selectFile"
        />
      </label>
    </div>
    <div v-if="pending" class="panel mt-8 flex flex-wrap items-center justify-between gap-4 p-6">
      <p role="status" class="text-arena-muted">{{ progress }}</p>
      <button type="button" class="button-secondary" @click="cancelLoad">取消加载</button>
    </div>
    <p
      v-if="error"
      role="alert"
      class="panel mt-8 break-words border-arena-danger/50 p-6 text-arena-danger"
    >
      {{ error }}
    </p>
    <ReplayViewer
      v-if="session"
      :key="session.replay.matchId"
      class="mt-8"
      :session="session"
      :file-name="fileName"
    />
    <div v-else-if="!pending && !error" class="panel mt-8 px-6 py-16 text-center sm:px-12">
      <svg
        class="mx-auto mb-6 size-16 text-arena-accent"
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
      >
        <rect x="9" y="9" width="46" height="46" rx="9" stroke="currentColor" stroke-width="2" />
        <path
          d="M26 21L43 32L26 43V21Z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </svg>
      <h2 class="text-xl font-semibold">选择一场比赛，回到起点</h2>
      <p class="mx-auto mt-3 max-w-lg leading-7 text-arena-muted">
        支持 CLI 生成的 .json.gz 文件。完整校验通过后，即可播放、逐 tick 查看和跳转错误。
      </p>
      <p class="mt-7 text-sm text-arena-muted">还没有回放？在项目根目录运行：</p>
      <pre
        class="mx-auto mt-3 max-w-full overflow-x-auto rounded-lg bg-arena-background p-4 text-left text-sm text-arena-accent"
      ><code>pnpm arena run --bot ./games/paper/bots/official.js --seed 42</code></pre>
    </div>
  </section>
</template>
