<script setup lang="ts">
import type { GameCatalogEntry, GameCodeInfo } from "@si-arena/protocol";
import { session } from "../auth/session";
import GameRulesPage from "./GameRulesPage.vue";

defineProps<{ game: GameCatalogEntry; code?: GameCodeInfo | null; entryReady?: boolean }>();
</script>

<template>
  <div class="space-y-6">
    <GameRulesPage :game="game" />
    <section aria-labelledby="my-code-title" class="min-w-0 border-t border-line pt-5">
      <h2 id="my-code-title" class="text-sm font-semibold">我的代码</h2>
      <template v-if="code">
        <p class="mt-2 text-xs text-soft">
          <span class="font-mono">{{ (code.sourceBytes / 1024).toFixed(1) }} KiB</span> ·
          <time :datetime="code.updatedAt">{{
            new Date(code.updatedAt).toLocaleString("zh-CN")
          }}</time>
        </p>
        <pre class="code-block mt-3 whitespace-pre-wrap break-all">{{ code.source }}</pre>
      </template>
      <p v-else class="mt-3 text-sm text-soft">
        {{
          !session.user ? "登录后查看或上传策略" : entryReady ? "尚未上传策略" : "正在读取当前策略…"
        }}
      </p>
    </section>
  </div>
</template>
