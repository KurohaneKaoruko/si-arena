<script setup lang="ts">
import type { MatchDetail } from "@si-arena/protocol";
import { computed, ref } from "vue";
import { arenaGame, useCatalog } from "../games/catalog";
import { gamePresentations } from "../games/index";
import { useArena } from "../composables/useArena";
import { useMatchReplay } from "../composables/useMatchReplay";
import { moveTabFocus } from "../utils/tablist";
import { relativeTime, shortTime } from "../utils/time";
import ArenaStatusCard from "../components/ArenaStatusCard.vue";
import ReplayLoadState from "../components/ReplayLoadState.vue";
import ReplayViewer from "../components/ReplayViewer.vue";
import AppBadge from "../components/ui/AppBadge.vue";
import AppButton from "../components/ui/AppButton.vue";
import StateBlock from "../components/ui/StateBlock.vue";

const catalog = useCatalog();
const game = computed(() => arenaGame(catalog.data.value?.games));
const arena = useArena(() => game.value);
const status = arena.status.data;
const presentation = computed(() =>
  game.value ? gamePresentations.get(game.value.id) : undefined,
);
const pickedId = ref<string | null>(null);
// Without an explicit pick, the newest run is shown, including one that just finished.
const selected = computed<MatchDetail | undefined>(() => {
  const recent = status.value?.recent ?? [];
  return recent.find((run) => run.id === pickedId.value) ?? recent[0];
});
const replay = useMatchReplay(() => selected.value);

function champions(run: MatchDetail) {
  return run.participants
    .filter((p) => p.rank === 1)
    .map((p) => p.username)
    .join("、");
}
function runSummary(run: MatchDetail) {
  if (run.status === "failed") return "系统失败 · 不计分";
  return `冠军 ${champions(run) || "—"} · ${run.result?.completedTicks ?? "—"} tick`;
}
</script>

<template>
  <StateBlock v-if="catalog.status.value === 'loading'" status="loading" />
  <StateBlock
    v-else-if="catalog.status.value === 'error'"
    status="error"
    :message="catalog.error.value"
    @retry="catalog.reload"
  />
  <StateBlock v-else-if="!game" status="empty" message="大逃杀暂未开放。" />
  <div v-else class="flex flex-col gap-8">
    <section class="flex flex-wrap items-stretch gap-6">
      <div class="flex min-w-0 flex-[999_1_32rem] flex-col justify-center gap-3.5">
        <p class="eyebrow">BATTLE ROYALE · {{ game.arena?.seats }} PLAYERS</p>
        <h1 class="text-[34px] leading-tight font-black sm:text-[40px]">{{ game.name }}</h1>
        <p class="max-w-[39rem] text-base leading-7 text-soft">{{ game.description }}</p>
        <div class="flex flex-wrap gap-2.5 pt-1">
          <AppButton :to="`/games/${encodeURIComponent(game.id)}`">上传大逃杀代码</AppButton>
          <AppButton variant="ghost" :to="`/games/${encodeURIComponent(game.id)}/development`"
            >开发资料</AppButton
          >
          <AppButton variant="ghost" :to="{ path: '/leaderboard', query: { game: game.id } }"
            >积分榜</AppButton
          >
        </div>
      </div>
      <ArenaStatusCard class="min-w-0 flex-[1_1_22rem]" :game="game" :arena="arena" />
    </section>

    <section aria-labelledby="lineup-title" class="flex flex-col gap-3.5">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="lineup-title" class="text-xl font-bold">下一局阵容</h2>
        <span class="text-sm text-soft">按积分实时取前 {{ game.arena?.seats }} · 开局瞬间锁定</span>
      </div>
      <StateBlock v-if="!status && arena.status.status.value === 'loading'" status="loading" />
      <StateBlock
        v-else-if="status && !status.lineup.length"
        status="empty"
        message="还没有选手上传大逃杀代码。"
      />
      <ol v-else-if="status" class="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-3">
        <li
          v-for="(entry, seat) in status.lineup"
          :key="entry.userId"
          class="card flex flex-col gap-3 rounded-[0.875rem] p-4"
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <span
              class="grid size-[2.125rem] shrink-0 place-items-center rounded-[0.5rem] font-display font-bold text-on-accent"
              :style="{ backgroundColor: `var(--color-player-${seat})` }"
              >{{ seat + 1 }}</span
            >
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-bold">{{ entry.username }}</span>
              <span class="text-xs text-faint">{{
                entry.official ? "官方补位" : `排名 #${seat + 1}`
              }}</span>
            </span>
          </div>
          <div class="flex justify-between text-[13px] text-soft">
            <span
              >积分 <b class="figure text-[15px] text-ink">{{ entry.points }}</b></span
            >
            <span>{{ entry.wins }} 冠</span>
          </div>
          <p class="text-xs text-faint">代码更新于 {{ shortTime(entry.codeUpdatedAt) }}</p>
        </li>
      </ol>
    </section>

    <section aria-labelledby="recent-title" class="flex flex-col gap-3.5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="recent-title" class="text-xl font-bold">
          最近 {{ game.arena?.keepMatches }} 场回放
        </h2>
        <div
          v-if="status?.recent.length"
          role="tablist"
          aria-label="选择回放"
          class="flex flex-wrap gap-1.5 rounded-panel border border-line bg-surface p-1"
          @keydown="moveTabFocus"
        >
          <button
            v-for="run in status.recent"
            :key="run.id"
            type="button"
            role="tab"
            :aria-selected="run.id === selected?.id"
            :tabindex="run.id === selected?.id ? 0 : -1"
            aria-controls="royale-replay"
            class="flex min-h-11 flex-col items-start justify-center gap-px rounded-[0.5625rem] px-3.5 py-1 text-left text-sm transition"
            :class="
              run.id === selected?.id ? 'bg-accent text-on-accent' : 'text-ink hover:bg-subtle'
            "
            @click="pickedId = run.id"
          >
            <span class="font-bold">{{ relativeTime(run.updatedAt) }}</span>
            <span class="text-xs opacity-80">{{ runSummary(run) }}</span>
          </button>
        </div>
      </div>
      <div id="royale-replay" :role="status?.recent.length ? 'tabpanel' : undefined">
        <StateBlock
          v-if="status && !selected"
          status="empty"
          message="还没有跑完的对局。开一局后，所有人都能在这里看回放。"
        />
        <StateBlock
          v-else-if="selected?.status === 'failed'"
          status="empty"
          message="这一局系统失败，没有回放，也不计分。"
        />
        <ReplayViewer
          v-else-if="replay.session.value"
          :key="replay.session.value.replay.matchId"
          :session="replay.session.value"
          source-kind="online"
        />
        <ReplayLoadState
          v-else-if="selected"
          :pending="replay.pending.value"
          :ticks="replay.ticks.value"
          :error="replay.error.value"
          :unsupported="replay.unsupported.value"
          @load="replay.load"
          @cancel="replay.cancel"
        />
      </div>
      <details v-if="presentation" class="card px-5 py-4">
        <summary class="cursor-pointer font-bold">规则要点</summary>
        <ul class="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-soft">
          <li v-for="item in presentation.instructions" :key="item">{{ item }}</li>
        </ul>
      </details>
      <p v-if="selected" class="text-xs text-faint">
        <AppBadge tone="outline">竞技场</AppBadge>
        {{ selected.release }} · 种子 {{ selected.seed }} · {{ shortTime(selected.updatedAt) }}
      </p>
    </section>
  </div>
</template>
