<script setup lang="ts">
import type { GameCatalogEntry, GameCodeInfo } from "@si-arena/protocol";
import { session } from "../auth/session";
import { shortTime } from "../utils/time";
import GameRulesPage from "./GameRulesPage.vue";

defineProps<{ game: GameCatalogEntry; code?: GameCodeInfo | null; entryReady?: boolean }>();
</script>

<template>
  <div class="space-y-6">
    <GameRulesPage :game="game" />
    <section aria-labelledby="my-code-title" class="min-w-0 space-y-3 border-t border-line pt-5">
      <h2 id="my-code-title" class="text-base font-bold">我的代码</h2>
      <template v-if="code">
        <p class="font-mono text-xs text-faint">
          {{ (code.sourceBytes / 1024).toFixed(1) }} KiB ·
          <time :datetime="code.updatedAt">{{ shortTime(code.updatedAt) }}</time>
        </p>
        <pre class="code-block break-all whitespace-pre-wrap">{{ code.source }}</pre>
      </template>
      <p v-else class="text-sm text-soft">
        {{
          !session.user ? "登录后查看或上传策略" : entryReady ? "尚未上传策略" : "正在读取当前策略…"
        }}
      </p>
    </section>
  </div>
</template>
