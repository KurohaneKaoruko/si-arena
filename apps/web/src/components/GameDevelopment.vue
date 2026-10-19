<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { parseGameDevelopment, parseGameReleaseMetadata } from "@si-arena/protocol";
import { computed, ref } from "vue";
import { useApiResource } from "../composables/useApiResource";

const props = defineProps<{ game: GameCatalogEntry }>();
const base = computed(() => `/api/games/${encodeURIComponent(props.game.id)}`);
const { data, pending, error, reload } = useApiResource(
  () => `${base.value}/development`,
  parseGameDevelopment,
);
const releasePath = computed(
  () => `${base.value}/releases/${encodeURIComponent(props.game.release)}`,
);
const {
  data: release,
  pending: releasePending,
  error: releaseError,
  reload: reloadRelease,
} = useApiResource(
  () => releasePath.value,
  (raw) => {
    const value = parseGameReleaseMetadata(raw);
    if (value.game.id !== props.game.id || value.game.release !== props.game.release)
      throw new Error("开发包与当前游戏发行不匹配");
    return value;
  },
);
const feedback = ref("");
const command = computed(
  () =>
    `npx @si-arena/cli@latest init ${props.game.id} ./${props.game.id}-bot --server ${JSON.stringify(window.location.origin)}`,
);
async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    feedback.value = `${label}已复制。`;
  } catch {
    feedback.value = "无法访问剪贴板，请手动选择并复制下方文本。";
  }
}
function sourceLink(source: string) {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(source)}`;
}
</script>
<template>
  <section
    id="development"
    class="panel mt-8 scroll-mt-6 p-7 sm:p-9"
    aria-labelledby="development-title"
  >
    <div class="flex flex-wrap items-start justify-between gap-5">
      <div>
        <p class="eyebrow">BUILD YOUR STRATEGY</p>
        <h2 id="development-title" class="mt-3 text-xl font-semibold">开发资料与本地工具</h2>
        <p class="mt-3 text-sm leading-7 text-arena-muted">
          复制提示词交给你选择的 AI，在本地编写、运行和改进策略，再上传参赛。
        </p>
      </div>
      <span
        class="rounded-lg border border-arena-border px-3 py-2 font-mono text-xs text-arena-muted"
        >{{ game.release }} · 接口 v{{ game.botProtocolVersion }}</span
      >
    </div>
    <div class="mt-7 rounded-xl bg-arena-background p-5">
      <h3 class="font-semibold">获取独立开发包</h3>
      <p class="mt-2 text-sm leading-7 text-arena-muted">
        包含引擎、沙箱、游戏、SDK、官方 bot 和回放播放器。要求 Node.js 26+、pnpm
        12，安装后可离线对战。
      </p>
      <p v-if="releasePending" role="status" class="mt-4 text-sm text-arena-muted">
        正在获取开发包信息…
      </p>
      <template v-else-if="release"
        ><div class="mt-4 flex flex-wrap items-center gap-3">
          <a class="button-primary" :href="`${releasePath}/download`" download>下载开发包 ZIP</a
          ><button class="button-secondary" @click="copy(command, '初始化命令')">
            复制初始化命令</button
          ><span class="text-xs text-arena-muted"
            >{{ (release.archive.bytes / 1024 / 1024).toFixed(1) }} MiB</span
          >
        </div>
        <pre
          class="mt-4 max-w-full overflow-x-auto text-sm leading-7 text-arena-accent"
        ><code>{{ command }}</code></pre>
        <p class="mt-3 text-xs leading-6 text-arena-muted">
          命令通过 npm 获取 CLI；也可直接下载 ZIP。解压或初始化后，运行 pnpm install
          --frozen-lockfile，再运行 pnpm arena run --bot ./bot.js。
        </p></template
      >
      <div v-else-if="releaseError" class="mt-4 text-sm text-arena-muted">
        <p>此发行的下载包暂不可用，仍可使用下方提示词和示例。</p>
        <button class="button-secondary mt-3" @click="reloadRelease">重新获取开发包</button>
      </div>
    </div>
    <p v-if="feedback" role="status" class="mt-5 text-sm text-arena-accent">{{ feedback }}</p>
    <p v-if="pending" role="status" class="mt-6 text-arena-muted">正在加载开发资料…</p>
    <div v-if="error" role="alert" class="mt-6">
      <p class="text-arena-danger">{{ error }}</p>
      <button class="button-secondary mt-3" @click="reload">重新加载资料</button>
    </div>
    <div v-if="data" class="mt-7 space-y-5">
      <details open class="border-t border-arena-border pt-5">
        <summary class="min-h-11 cursor-pointer py-3 font-semibold">统一参赛提示词</summary>
        <div class="mb-4 flex flex-wrap gap-3">
          <button class="button-secondary" @click="copy(data.prompt, '参赛提示词')">
            复制提示词</button
          ><a class="button-secondary" :href="sourceLink(data.prompt)" download="PROMPT.md"
            >下载提示词</a
          >
        </div>
        <textarea
          aria-label="统一参赛提示词"
          class="field-input min-h-64 resize-y p-4 font-mono text-sm leading-7"
          readonly
          :value="data.prompt"
        />
      </details>
      <details class="border-t border-arena-border pt-5">
        <summary class="min-h-11 cursor-pointer py-3 font-semibold">SDK 与执行说明</summary>
        <button class="button-secondary mb-4" @click="copy(data.sdk, 'SDK 说明')">
          复制 SDK 说明
        </button>
        <pre
          class="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-arena-background p-4 text-sm leading-7"
          >{{ data.sdk }}</pre>
      </details>
      <details class="border-t border-arena-border pt-5">
        <summary class="min-h-11 cursor-pointer py-3 font-semibold">官方示例 bot</summary>
        <div class="mb-4 flex flex-wrap gap-3">
          <button class="button-secondary" @click="copy(data.officialBot, '官方代码')">
            复制官方代码</button
          ><a class="button-secondary" :href="sourceLink(data.officialBot)" download="official.js"
            >下载 official.js</a
          >
        </div>
        <pre
          class="max-h-96 overflow-auto rounded-lg bg-arena-background p-4 font-mono text-xs leading-6"
          >{{ data.officialBot }}</pre>
      </details>
      <details class="border-t border-arena-border pt-5">
        <summary class="min-h-11 cursor-pointer py-3 font-semibold">最小代码模板</summary>
        <a class="button-secondary mb-4" :href="sourceLink(data.template)" download="bot.js"
          >下载 bot.js</a
        >
        <pre
          class="max-h-96 overflow-auto rounded-lg bg-arena-background p-4 font-mono text-xs leading-6"
          >{{ data.template }}</pre>
      </details>
    </div>
  </section>
</template>
