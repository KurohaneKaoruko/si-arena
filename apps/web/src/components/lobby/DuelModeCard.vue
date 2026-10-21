<script setup lang="ts">
import type { GameCatalogEntry } from "@si-arena/protocol";
import { computed } from "vue";
import { useRoute } from "vue-router";
import { parseGameMe } from "../../api/contracts";
import { session } from "../../auth/session";
import { useApiResource } from "../../composables/useApiResource";
import { useMatchRequest } from "../../composables/useMatchRequest";
import { gameMatchLocation } from "../../games/locations";
import AppButton from "../ui/AppButton.vue";

const props = defineProps<{ game: GameCatalogEntry }>();
const route = useRoute();
const workspace = computed(() => `/games/${encodeURIComponent(props.game.id)}`);
const { data, status, reload } = useApiResource(() => `/api${workspace.value}/me`, parseGameMe, {
  authenticated: true,
  notify: false,
});
const match = useMatchRequest(() => props.game.id);
const bossBusy = computed(() => match.pending.value && match.body.value?.boss === true);
</script>

<template>
  <article class="card flex flex-col gap-[1.125rem] p-6 sm:p-7">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-2xl font-bold">{{ game.name }} · 1v1 排位</h3>
      <span
        class="rounded-[0.375rem] border border-line-strong px-2 py-1 font-mono text-xs text-soft"
        >{{ game.minPlayers }} 人 · {{ game.maxTicks }} tick</span
      >
    </div>
    <p class="text-[15px] leading-7 text-soft">
      {{ game.description }} 系统按排位分找实力接近的对手，对手离线也能开局。
    </p>
    <template v-if="session.user">
      <p v-if="status === 'error'" class="text-sm text-soft">
        暂时读不到你的战绩。<AppButton size="sm" variant="link" @click="reload">重试</AppButton>
      </p>
      <dl v-else class="grid grid-cols-3 gap-3">
        <div class="tile p-3.5">
          <dt class="text-xs text-faint">排位分</dt>
          <dd class="figure mt-1.5 text-[26px]">{{ data ? data.entry.rating.toFixed(0) : "—" }}</dd>
        </div>
        <div class="tile p-3.5">
          <dt class="text-xs text-faint">胜 / 平 / 负</dt>
          <dd class="figure mt-1.5 text-[26px]">
            {{ data ? `${data.entry.wins}/${data.entry.draws}/${data.entry.losses}` : "—" }}
          </dd>
        </div>
        <div class="tile p-3.5">
          <dt class="text-xs text-faint">{{ data?.boss.available ? "Boss 胜 / 挑战" : "已赛" }}</dt>
          <dd class="figure mt-1.5 text-[26px]">
            {{
              !data
                ? "—"
                : data.boss.available
                  ? `${data.boss.wins}/${data.boss.attempts}`
                  : data.entry.matchesPlayed
            }}
          </dd>
        </div>
      </dl>
    </template>
    <div class="mt-auto flex flex-wrap gap-2.5">
      <AppButton
        v-if="session.ready && !session.user"
        variant="primary"
        :to="{ path: '/login', query: { next: route.fullPath } }"
        >登录参赛</AppButton
      >
      <AppButton
        v-else-if="data?.activeMatch"
        variant="primary"
        :to="gameMatchLocation(game.id, data.activeMatch.id)"
        >查看当前比赛</AppButton
      >
      <AppButton
        v-else-if="data?.canMatch"
        variant="primary"
        :loading="match.pending.value && !bossBusy"
        :disabled="match.pending.value"
        @click="match.start()"
        >发起匹配</AppButton
      >
      <AppButton v-else variant="primary" :to="{ path: workspace, hash: '#participate' }"
        >上传策略</AppButton
      >
      <AppButton
        v-if="data?.boss.available && data.canMatch && !data.activeMatch"
        variant="danger"
        :loading="bossBusy"
        :disabled="match.pending.value"
        @click="match.start({ boss: true })"
        >挑战 Boss</AppButton
      >
      <AppButton :to="`${workspace}/development`">开发资料</AppButton>
    </div>
  </article>
</template>
