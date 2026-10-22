import { PAPER_CONFIG, PAPER_MAX_TICKS } from "./constants";
import {
  resolveResourceLimits,
  type GameCatalogEntry,
  type GameManifest,
} from "@si-arena/protocol";

export const paperManifest = {
  id: "paper",
  name: "网格圈地",
  description: "离开领地，拉出尾迹，安全回城。踩住对手的尾迹就把他打回起点，最后比谁的格子多。",
  release: "paper@0.3.0",
  botProtocolVersion: 2,
  minPlayers: 2,
  maxPlayers: 2,
  maxTicks: PAPER_MAX_TICKS,
  config: PAPER_CONFIG,
} satisfies GameManifest;

export const paperCatalogEntry: GameCatalogEntry = {
  ...paperManifest,
  resolvedLimits: resolveResourceLimits(),
};
