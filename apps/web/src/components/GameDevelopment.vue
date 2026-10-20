<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { parseGameDevelopment, parseGameReleaseMetadata } from "@si-arena/protocol";
import { computed, ref, watch } from "vue";
import { useApiResource } from "../composables/useApiResource";
import { useToast } from "../composables/useToast";
import { copyText } from "../utils/clipboard";
import AppBadge from "./ui/AppBadge.vue";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";

const props = defineProps<{ game: GameCatalogEntry }>();
const toast = useToast();
const promptOpen = ref(false);
const setupOpen = ref(false);
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
const setupPrompt = computed(() => {
  const directory = `./${props.game.id}-bot`;
  return [
    `我要参加 SI Arena 平台的「${props.game.name}」编程竞技。请你在我的电脑上完成环境准备、项目初始化与依赖安装，然后按项目内的参赛提示词为我编写参赛 bot，并用本地工具验证通过。`,
    ``,
    `1. 检查环境（node -v、pnpm -v）：需要 Node.js ≥ 26 与 pnpm ≥ 12；缺失或版本过低时，自行选择当前系统上合适的方式安装或升级。`,
    `2. 在当前目录执行初始化命令：`,
    `   ${command.value}`,
    `3. 进入 ${directory}，执行 pnpm install --frozen-lockfile。`,
    `4. 依次完整阅读项目内的 PROMPT.md（比赛规则与胜负判定）、SDK.md（每 tick 玩家接口）和 bots/official.js（官方示例策略）。`,
    `5. 以明显强于官方示例 bot 为目标编写完整参赛代码，写入 bot.js 覆盖模板；PROMPT.md 中「只输出最终完整代码」指写入该文件，不要另建文件或输出围栏。`,
    `6. 运行 pnpm arena run --bot ./bot.js --matches 20 --seed 42，按 PROMPT.md 的强度标准验证：对官方 bot 胜率不低于 80%、无执行错误；未达标继续改进并复测。`,
    `7. 完成后向我报告最终战绩，并提醒我回到平台网页，在游戏页用「上传策略」选择（或拖放）bot.js 文件上传参赛。`,
  ].join("\n");
});
async function copy(text: string, label: string, onFail?: () => void) {
  if (await copyText(text)) {
    toast.success(`${label}已复制。`);
    return;
  }
  onFail?.();
  toast.warning("无法访问剪贴板，请手动选择并复制下方文本。");
}
function sourceLink(source: string) {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(source)}`;
}
// The route reuses this component across games; collapsed panels must not leak between them.
watch(
  () => props.game.id,
  () => {
    promptOpen.value = false;
    setupOpen.value = false;
  },
);
</script>

<template>
  <section id="development" class="max-w-4xl scroll-mt-20" aria-labelledby="development-title">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
      <div class="min-w-0">
        <h2 id="development-title" class="text-[15px] font-semibold tracking-tight">开发资料</h2>
      </div>
      <AppBadge mono>{{ game.release }} · 接口 v{{ game.botProtocolVersion }}</AppBadge>
    </header>

    <div class="border-b border-line py-5">
      <h3 class="text-sm font-semibold">快速开始</h3>
      <p class="mt-1.5 text-sm leading-6 text-soft">Node.js 26+ · pnpm 12</p>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <AppButton variant="primary" @click="copy(command, '初始化命令')">复制初始化命令</AppButton>
        <AppButton
          variant="secondary"
          @click="copy(setupPrompt, 'AI 安装提示词', () => (setupOpen = true))"
          >复制 AI 安装提示词</AppButton
        >
        <AppButton v-if="release" variant="secondary" :href="`${releasePath}/download`" download
          >下载开发包 ZIP</AppButton
        >
        <span v-if="release" class="font-mono text-xs text-faint"
          >{{ (release.archive.bytes / 1024 / 1024).toFixed(1) }} MiB</span
        >
      </div>
      <pre class="code-block mt-4 text-accent"><code>{{ command }}</code></pre>
      <details :open="setupOpen" @toggle="setupOpen = ($event.target as HTMLDetailsElement).open">
        <summary class="w-fit cursor-pointer py-2 text-xs text-soft hover:text-ink">
          查看 AI 安装提示词全文（环境准备、初始化与编写 bot 一条龙）
        </summary>
        <textarea
          aria-label="AI 安装提示词"
          class="input min-h-72 resize-y p-3.5 font-mono text-[13px] leading-6"
          readonly
          :value="setupPrompt"
        />
      </details>
      <StateBlock v-if="releaseStatus === 'loading'" class="mt-4" status="loading" />
      <div v-else-if="releaseStatus === 'error'" class="mt-4">
        <p class="text-sm leading-6 text-soft">
          此发行的下载包暂不可用，初始化命令与提示词仍可使用。
        </p>
        <AppButton class="mt-3" variant="secondary" @click="reloadRelease"
          >重新获取开发包</AppButton
        >
      </div>
    </div>

    <div class="py-4">
      <StateBlock v-if="status === 'loading'" status="loading" />
      <StateBlock v-else-if="status === 'error'" status="error" :message="error" @retry="reload" />
      <div v-else-if="data" class="space-y-4">
        <section>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="text-sm font-semibold">统一参赛提示词</h3>
            <div class="flex flex-wrap gap-2">
              <AppButton
                variant="secondary"
                @click="copy(data.prompt, '参赛提示词', () => (promptOpen = true))"
                >复制提示词</AppButton
              >
              <AppButton variant="secondary" :href="sourceLink(data.prompt)" download="PROMPT.md"
                >下载提示词</AppButton
              >
            </div>
          </div>
          <details
            :open="promptOpen"
            @toggle="promptOpen = ($event.target as HTMLDetailsElement).open"
          >
            <summary class="w-fit cursor-pointer py-3 text-xs text-soft hover:text-ink">
              查看提示词全文
            </summary>
            <textarea
              aria-label="统一参赛提示词"
              class="input min-h-64 resize-y p-3.5 font-mono text-[13px] leading-6"
              readonly
              :value="data.prompt"
            />
          </details>
        </section>
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
