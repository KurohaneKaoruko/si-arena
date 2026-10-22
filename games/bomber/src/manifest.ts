import {
  BOMBER_CONFIG,
  BOMBER_MAX_PLAYERS,
  BOMBER_MAX_TICKS,
  BOMBER_MIN_PLAYERS,
} from "./constants";
import {
  resolveResourceLimits,
  type GameCatalogEntry,
  type GameManifest,
} from "@si-arena/protocol";

export const bomberManifest = {
  id: "bomber",
  name: "炸弹人",
  description:
    "最多四人在固定地图上放置定时炸弹，炸墙拾取道具，被火焰波及即出局，后期外圈坍塌逼向中心。",
  release: "bomber@0.1.0",
  botProtocolVersion: 1,
  minPlayers: BOMBER_MIN_PLAYERS,
  maxPlayers: BOMBER_MAX_PLAYERS,
  maxTicks: BOMBER_MAX_TICKS,
  config: BOMBER_CONFIG,
  arena: { seats: 4, keepMatches: 3, tieBreakGameId: "paper" },
} satisfies GameManifest;

export const bomberCatalogEntry: GameCatalogEntry = {
  ...bomberManifest,
  resolvedLimits: resolveResourceLimits(),
};
