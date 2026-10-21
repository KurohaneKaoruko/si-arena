<script setup lang="ts">
import { session } from "../auth/session";
import AppBadge from "./ui/AppBadge.vue";

/** 你 / 官方 / Boss markers after a player name. */
defineProps<{ player: { userId: string; official: boolean; boss?: boolean } }>();
</script>

<template>
  <AppBadge v-if="player.userId === session.user?.id" tone="solid">你</AppBadge>
  <AppBadge v-if="player.official" tone="outline">官方</AppBadge>
  <AppBadge v-if="player.boss" tone="danger">Boss</AppBadge>
</template>
