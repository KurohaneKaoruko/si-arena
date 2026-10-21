<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed } from "vue";
import { useRoute } from "vue-router";
import { session } from "../auth/session";
import type { useArena } from "../composables/useArena";
import AppButton from "./ui/AppButton.vue";
import StateBlock from "./ui/StateBlock.vue";

/** Idle or running state of the shared arena, with the start button. */
const props = defineProps<{ game: GameCatalogEntry; arena: ReturnType<typeof useArena> }>();
const route = useRoute();
const { status, starting, error, start } = props.arena;
const active = computed(() => status.data.value?.active ?? null);
const starter = computed(
  () => active.value?.participants.find((p) => p.userId === active.value?.initiatorId)?.username,
);
const tooFew = computed(() => (status.data.value?.lineup.length ?? 0) < 2);
</script>

<template>
  <div class="card flex flex-col gap-4 border-accent-line p-6" aria-live="polite">
    <StateBlock v-if="status.status.value === 'loading'" status="loading" />
    <StateBlock
      v-else-if="status.status.value === 'error'"
      status="error"
      :message="status.error.value"
      @retry="status.reload"
    />
    <template v-else-if="active">
      <p class="flex items-center gap-3 text-lg font-bold">
        <span
          class="size-2.5 rounded-full bg-warning shadow-[0_0_0_4px_rgb(255_176_32/0.2)]"
          aria-hidden="true"
        ></span>
        {{ active.status === "pending" ? "等待开局" : "正在运行"
        }}{{ starter ? ` · 由 ${starter} 开局` : "" }}
      </p>
      <p class="text-sm leading-7 text-soft">
        {{ active.participants.length }} 人入场：{{
          active.participants.map((p) => p.username).join("、")
        }}。跑完后所有人都能看回放。
      </p>
      <AppButton size="lg" disabled class="min-h-[3.25rem] text-base">本局跑完前不能再开</AppButton>
    </template>
    <template v-else>
      <p class="flex items-center gap-3 text-lg font-bold">
        <span
          class="size-2.5 rounded-full bg-accent shadow-[0_0_0_4px_rgb(197_240_74/0.18)]"
          aria-hidden="true"
        ></span>
        竞技场空闲
      </p>
      <p class="text-sm leading-7 text-soft">
        点下开始后，服务器按当前排行榜抽取前 {{ game.arena?.seats }}
        名并锁定他们此刻的代码。开跑期间按钮对所有人置灰。
      </p>
      <AppButton
        v-if="session.ready && !session.user"
        size="lg"
        variant="primary"
        class="min-h-[3.25rem] text-base"
        :to="{ path: '/login', query: { next: route.fullPath } }"
        >登录后开局</AppButton
      >
      <AppButton
        v-else
        size="lg"
        variant="primary"
        class="min-h-[3.25rem] text-[17px]"
        :loading="starting"
        :disabled="tooFew"
        @click="start"
      >
        <svg class="size-[18px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 4.5v15l13-7.5z" />
        </svg>
        开一局
      </AppButton>
      <p v-if="tooFew" class="text-[13px] text-soft">入场选手少于 2 人时不能开局。</p>
    </template>
    <p v-if="error" role="alert" class="text-sm text-danger-ink">{{ error }}</p>
    <p
      class="flex flex-wrap justify-between gap-3 border-t border-line pt-3 text-[13px] text-faint"
    >
      <span>服务器只保留最近 {{ game.arena?.keepMatches }} 场</span>
      <span class="font-mono">{{ game.release }}</span>
    </p>
  </div>
</template>
