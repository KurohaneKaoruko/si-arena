<script setup lang="ts">
import type { MatchSummary } from "@si-arena/protocol";
import { RouterLink } from "vue-router";
import { session } from "../auth/session";
import { matchOutcome, ratingDelta } from "../games/match-summary";
import AppBadge from "./ui/AppBadge.vue";
import { gameMatchLocation } from "../games/locations";

defineProps<{ matches: MatchSummary[] }>();
function opponents(match: MatchSummary) {
  const others = match.participants.filter((p) => p.userId !== session.user?.id);
  return others.length ? others : match.participants;
}
function ownDelta(match: MatchSummary) {
  return match.status === "failed"
    ? "不计分"
    : ratingDelta(match.participants.find((p) => p.userId === session.user?.id));
}
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-card border border-line">
    <ul>
      <li v-for="match in matches" :key="match.id" class="border-b border-line last:border-b-0">
        <RouterLink
          :to="gameMatchLocation(match.gameId, match.id)"
          class="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition hover:bg-subtle"
        >
          <span
            class="text-sm font-medium"
            :class="{
              'text-success': matchOutcome(match, session.user?.id).tone === 'success',
              'text-danger': matchOutcome(match, session.user?.id).tone === 'danger',
              'text-accent': match.status === 'running',
              'text-warning': match.status === 'pending',
            }"
            >{{ matchOutcome(match, session.user?.id).label }}</span
          >
          <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
            ><span v-for="player in opponents(match)" :key="player.userId" class="min-w-0 break-all"
              >{{ player.username }}
              <AppBadge v-if="player.official" class="ml-1">官方</AppBadge></span
            ></span
          >
          <span
            class="text-right font-mono text-sm tabular-nums"
            :class="
              ownDelta(match).startsWith('+')
                ? 'text-success'
                : ownDelta(match).startsWith('-')
                  ? 'text-danger'
                  : 'text-soft'
            "
            >{{ ownDelta(match) }}</span
          >
          <time class="col-start-2 text-xs text-soft" :datetime="match.createdAt">{{
            new Date(match.createdAt).toLocaleString("zh-CN", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          }}</time>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
