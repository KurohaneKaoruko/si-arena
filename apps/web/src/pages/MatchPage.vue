<script setup lang="ts">
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { parseMatch } from "../api/contracts";
import { useApiResource } from "../composables/useApiResource";
import { gameMatchLocation } from "../games/locations";
import AppButton from "../components/ui/AppButton.vue";
import StateBlock from "../components/ui/StateBlock.vue";

// Resolve existing public links to the same workspace used by new match requests.
const route = useRoute();
const router = useRouter();
const { data, status, error, reload } = useApiResource(
  () => `/api/matches/${encodeURIComponent(String(route.params.matchId))}`,
  parseMatch,
  { notify: false },
);
watch(data, (match) => {
  if (match) void router.replace(gameMatchLocation(match.gameId, match.id));
});
</script>

<template>
  <StateBlock v-if="status === 'error'" status="error" :message="error" @retry="reload" />
  <StateBlock v-else status="loading" />
  <AppButton v-if="status === 'error'" class="mt-4" to="/">游戏大厅</AppButton>
</template>
