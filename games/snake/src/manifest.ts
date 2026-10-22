import { SNAKE_CONFIG, SNAKE_MAX_PLAYERS, SNAKE_MAX_TICKS, SNAKE_MIN_PLAYERS } from "./constants";
import {
  resolveResourceLimits,
  type GameCatalogEntry,
  type GameManifest,
} from "@si-arena/protocol";

export const snakeManifest = {
  id: "snake",
  name: "贪吃蛇大作战",
  description:
    "最多四条蛇同场，吃食物变长、恢复体力，撞墙、撞身或头对头更短的一方出局，活到最后的蛇获胜。",
  release: "snake@0.1.0",
  botProtocolVersion: 1,
  minPlayers: SNAKE_MIN_PLAYERS,
  maxPlayers: SNAKE_MAX_PLAYERS,
  maxTicks: SNAKE_MAX_TICKS,
  config: SNAKE_CONFIG,
  arena: { seats: 4, keepMatches: 3, tieBreakGameId: "paper" },
} satisfies GameManifest;

export const snakeCatalogEntry: GameCatalogEntry = {
  ...snakeManifest,
  resolvedLimits: resolveResourceLimits(),
};
