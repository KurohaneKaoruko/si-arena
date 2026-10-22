import { TANK_CONFIG, TANK_MAX_TICKS, TANK_PLAYERS } from "./constants";
import {
  resolveResourceLimits,
  type GameCatalogEntry,
  type GameManifest,
} from "@si-arena/protocol";

export const tankManifest = {
  id: "tank",
  name: "坦克对决",
  description:
    "两辆坦克在中心对称的砖墙迷宫里机动开火，炮弹打穿砖墙，先把对手打到 0 点生命的一方获胜。",
  release: "tank@0.1.0",
  botProtocolVersion: 1,
  minPlayers: TANK_PLAYERS,
  maxPlayers: TANK_PLAYERS,
  maxTicks: TANK_MAX_TICKS,
  config: TANK_CONFIG,
} satisfies GameManifest;

export const tankCatalogEntry: GameCatalogEntry = {
  ...tankManifest,
  resolvedLimits: resolveResourceLimits(),
};
