import type { GameCatalogEntry } from "@si-arena/protocol";
import { snakeMapSize } from "../constants";

export { SNAKE_PALETTE } from "./palette";

export { drawSnakeBoard, snakePlayerSummaries, type SnakeBoardAnimation } from "./board";
export { snakeHighlights } from "./highlights";

export const snakePresentation = {
  id: "snake",
  headline: "吃食物变长，活到最后",
  instructions: Object.freeze([
    "最多四条蛇同场，每 tick 选择一个移动方向，蛇不能停留。",
    "吃到食物长一节并把体力补满；体力每 tick 减 1，归零就饿死。",
    "撞墙、撞到任何蛇身，或头对头相撞时更短的一方，都会立即出局。",
    "最后存活者获胜；回合耗尽时存活者按长度排名。",
  ]),
  getStats(game: GameCatalogEntry) {
    return [
      { label: "参赛人数", value: `${game.minPlayers}–${game.maxPlayers}` },
      {
        label: "地图尺寸",
        value: `${snakeMapSize(game.minPlayers)}–${snakeMapSize(game.maxPlayers)} 见方`,
      },
      { label: "回合上限", value: String(game.maxTicks) },
      { label: "每 tick CPU", value: `${game.resolvedLimits.cpuMs} ms` },
    ];
  },
};
