<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { parseGameDevelopment, parseGameReleaseMetadata } from "@si-arena/protocol";
import { computed, ref } from "vue";
import { useApiResource } from "../composables/useApiResource";
import { useToast } from "../composables/useToast";
import AppBadge from "./ui/AppBadge.vue";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";

const props = defineProps<{ game: GameCatalogEntry }>();
const toast = useToast();
const base = computed(() => `/api/games/${encodeURIComponent(props.game.id)}`);
const { data, status, error, reload } = useApiResource(
  () => `${base.value}/development`,
  parseGameDevelopment,
);
const releasePath = computed(
  () => `${base.value}/releases/${encodeURIComponent(props.game.release)}`,
);
const {
  data: release,
  status: releaseStatus,
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
const command = computed(
  () =>
    `npx @si-arena/cli@latest init ${props.game.id} ./${props.game.id}-bot --server ${JSON.stringify(window.location.origin)}`,
);
async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label}已复制。`);
  } catch {
    toast.warning("无法访问剪贴板，请手动选择并复制下方文本。");
  }
}
function sourceLink(source: string) {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(source)}`;
}
</script>

<template>
  <section
    id="development"
    class="mt-8 scroll-mt-20 rounded-card border border-line bg-surface shadow-card"
    aria-labelledby="development-title"
  >
    <header class="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div class="min-w-0">
        <h2 id="development-title" class="text-[15px] font-semibold tracking-tight">
          开发资料与本地工具
        </h2>
        <p class="mt-1 text-sm leading-6 text-soft">
          把提示词交给你选择的 AI，在本地编写、运行和改进策略。
        </p>
      </div>
      <AppBadge mono>{{ game.release }} · 接口 v{{ game.botProtocolVersion }}</AppBadge>
    </header>

    <div class="border-b border-line px-5 py-5">
      <h3 class="text-sm font-semibold">获取独立开发包</h3>
      <p class="mt-1.5 text-sm leading-6 text-soft">
        包含引擎、沙箱、游戏、SDK、官方 bot 和回放播放器。需要 Node.js 26+ 与 pnpm
        12，安装后可离线对战。
      </p>
      <StateBlock v-if="releaseStatus === 'loading'" class="mt-4" status="loading" />
      <div v-else-if="release" class="mt-4">
        <div class="flex flex-wrap items-center gap-2">
          <AppButton variant="primary" :href="`${releasePath}/download`" download
            >下载开发包 ZIP</AppButton
          >
          <AppButton variant="secondary" @click="copy(command, '初始化命令')"
            >复制初始化命令</AppButton
          >
          <span class="font-mono text-xs text-faint"
            >{{ (release.archive.bytes / 1024 / 1024).toFixed(1) }} MiB</span
          >
        </div>
        <pre class="code-block mt-4 text-accent"><code>{{ command }}</code></pre>
      </div>
      <div v-else-if="releaseStatus === 'error'" class="mt-4">
        <p class="text-sm leading-6 text-soft">
          此发行的下载包暂不可用，仍可使用下方提示词和示例。
        </p>
        <AppButton class="mt-3" variant="secondary" @click="reloadRelease"
          >重新获取开发包</AppButton
        >
      </div>
    </div>

    <div class="px-5 py-5">
      <StateBlock v-if="status === 'loading'" status="loading" />
      <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
      <div v-else-if="data" class="space-y-4">
        <details open class="border-t border-line pt-4">
          <summary
            class="flex min-h-9 cursor-pointer items-center text-sm font-semibold transition marker:text-faint hover:text-accent"
          >
            统一参赛提示词
          </summary>
          <div class="mt-3 flex flex-wrap gap-2">
            <AppButton variant="secondary" @click="copy(data.prompt, '参赛提示词')"
              >复制提示词</AppButton
            >
            <AppButton variant="secondary" :href="sourceLink(data.prompt)" download="PROMPT.md"
              >下载提示词</AppButton
            >
          </div>
          <textarea
            aria-label="统一参赛提示词"
            class="input mt-3 min-h-64 resize-y p-3.5 font-mono text-[13px] leading-6"
            readonly
            :value="data.prompt"
          />
        </details>
        <details class="border-t border-line pt-4">
          <summary
            class="flex min-h-9 cursor-pointer items-center text-sm font-semibold transition marker:text-faint hover:text-accent"
          >
            SDK 与执行说明
          </summary>
          <AppButton class="mt-3" variant="secondary" @click="copy(data.sdk, 'SDK 说明')"
            >复制 SDK 说明</AppButton
          >
          <pre class="code-block mt-3 max-h-[32rem] whitespace-pre-wrap break-words">{{
            data.sdk
          }}</pre>
        </details>
        <details class="border-t border-line pt-4">
          <summary
            class="flex min-h-9 cursor-pointer items-center text-sm font-semibold transition marker:text-faint hover:text-accent"
          >
            官方示例 bot
          </summary>
          <div class="mt-3 flex flex-wrap gap-2">
            <AppButton variant="secondary" @click="copy(data.officialBot, '官方代码')"
              >复制官方代码</AppButton
            >
            <AppButton
              variant="secondary"
              :href="sourceLink(data.officialBot)"
              download="official.js"
              >下载 official.js</AppButton
            >
          </div>
          <pre class="code-block mt-3 max-h-96">{{ data.officialBot }}</pre>
        </details>
        <details class="border-t border-line pt-4">
          <summary
            class="flex min-h-9 cursor-pointer items-center text-sm font-semibold transition marker:text-faint hover:text-accent"
          >
            最小代码模板
          </summary>
          <AppButton
            class="mt-3"
            variant="secondary"
            :href="sourceLink(data.template)"
            download="bot.js"
            >下载 bot.js</AppButton
          >
          <pre class="code-block mt-3 max-h-96">{{ data.template }}</pre>
        </details>
      </div>
    </div>
  </section>
</template>
