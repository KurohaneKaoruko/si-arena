<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed } from "vue";
import { gamePresentations } from "../games/index";

const props = defineProps<{ game: GameCatalogEntry }>();
const presentation = computed(() => gamePresentations.get(props.game.id));
const stats = computed(() => presentation.value?.getStats(props.game) ?? []);
</script>

<template>
  <section class="space-y-4" aria-labelledby="rules-title">
    <h2 id="rules-title" class="text-xl font-bold">玩法</h2>
    <p v-if="!presentation" class="text-sm leading-7 text-soft">{{ game.description }}</p>
    <dl v-if="stats.length" class="grid grid-cols-2 gap-2.5">
      <div v-for="stat in stats" :key="stat.label" class="tile p-3">
        <dt class="text-xs text-faint">{{ stat.label }}</dt>
        <dd class="mt-1 font-bold">{{ stat.value }}</dd>
      </div>
    </dl>
    <ol
      v-if="presentation"
      class="list-decimal space-y-2 pl-5 text-sm leading-7 text-soft marker:text-faint"
    >
      <li v-for="instruction in presentation.instructions" :key="instruction">
        {{ instruction }}
      </li>
    </ol>
    <details class="rounded-panel border border-line px-4 py-3 text-sm text-soft">
      <summary class="w-fit cursor-pointer py-0.5 font-bold text-ink">执行限制</summary>
      <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
        <div>
          <dt class="text-xs text-faint">源码上限</dt>
          <dd class="mt-1 font-mono text-ink">{{ game.resolvedLimits.codeBytes / 1024 }} KiB</dd>
        </div>
        <div>
          <dt class="text-xs text-faint">CPU / tick</dt>
          <dd class="mt-1 font-mono text-ink">{{ game.resolvedLimits.cpuMs }} ms</dd>
        </div>
        <div>
          <dt class="text-xs text-faint">运行内存</dt>
          <dd class="mt-1 font-mono text-ink">
            {{ game.resolvedLimits.heapBytes / 1024 / 1024 }} MiB
          </dd>
        </div>
        <div>
          <dt class="text-xs text-faint">Memory</dt>
          <dd class="mt-1 font-mono text-ink">{{ game.resolvedLimits.memoryBytes / 1024 }} KiB</dd>
        </div>
      </dl>
    </details>
    <p class="rounded-panel border border-line p-3.5 text-[13px] leading-6 text-soft">
      执行出错时，该 tick 使用默认动作并保留上次成功的 Memory，下一 tick 继续执行。
    </p>
  </section>
</template>
