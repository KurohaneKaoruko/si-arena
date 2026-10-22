import {
  ROYALE_CONFIG,
  ROYALE_MAX_PLAYERS,
  ROYALE_MAX_TICKS,
  ROYALE_MIN_PLAYERS,
} from "./constants";
import {
  resolveResourceLimits,
  type GameCatalogEntry,
  type GameManifest,
} from "@si-arena/protocol";

export const royaleManifest = {
  id: "royale",
  name: "圈地大逃杀",
  description: "最多五人同场圈地，尾迹被切断即出局，安全区随淘汰收缩，活到最后的人获胜。",
  release: "royale@0.2.0",
  botProtocolVersion: 1,
  minPlayers: ROYALE_MIN_PLAYERS,
  maxPlayers: ROYALE_MAX_PLAYERS,
  maxTicks: ROYALE_MAX_TICKS,
  config: ROYALE_CONFIG,
  arena: { seats: 5, keepMatches: 3, points: [10, 6, 3, 1, 0], tieBreakGameId: "paper" },
} satisfies GameManifest;

export const royaleCatalogEntry: GameCatalogEntry = {
  ...royaleManifest,
  resolvedLimits: resolveResourceLimits(),
};
