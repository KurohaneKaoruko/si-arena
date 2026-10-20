<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed } from "vue";
import { gamePresentations } from "../games/index";

const props = defineProps<{ game: GameCatalogEntry }>();
const presentation = computed(() => gamePresentations.get(props.game.id));
const stats = computed(() => presentation.value?.getStats(props.game) ?? []);
</script>

<template>
  <section class="max-w-3xl" aria-labelledby="rules-title">
    <h2 id="rules-title" class="text-sm font-semibold">玩法</h2>
    <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-3 text-xs">
      <div v-for="stat in stats" :key="stat.label">
        <dt class="text-xs text-soft">{{ stat.label }}</dt>
        <dd class="mt-1 font-mono">{{ stat.value }}</dd>
      </div>
    </dl>
    <ul v-if="presentation" class="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-soft">
      <li v-for="instruction in presentation.instructions" :key="instruction">{{ instruction }}</li>
    </ul>
    <details class="mt-4 text-sm text-soft">
      <summary class="w-fit cursor-pointer py-1">执行限制</summary>
      <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <dt class="text-xs text-soft">源码上限</dt>
          <dd class="mt-1 font-mono text-sm">{{ game.resolvedLimits.codeBytes / 1024 }} KiB</dd>
        </div>
        <div>
          <dt class="text-xs text-soft">CPU / tick</dt>
          <dd class="mt-1 font-mono text-sm">{{ game.resolvedLimits.cpuMs }} ms</dd>
        </div>
        <div>
          <dt class="text-xs text-soft">运行内存</dt>
          <dd class="mt-1 font-mono text-sm">
            {{ game.resolvedLimits.heapBytes / 1024 / 1024 }} MiB
          </dd>
        </div>
        <div>
          <dt class="text-xs text-soft">Memory</dt>
          <dd class="mt-1 font-mono text-sm">{{ game.resolvedLimits.memoryBytes / 1024 }} KiB</dd>
        </div>
      </dl>
      <p class="mt-4 text-sm leading-7 text-soft">
        玩家执行出错时，该 tick 使用默认动作并保留上次成功的 Memory，下一 tick 继续执行。
      </p>
    </details>
  </section>
</template>
