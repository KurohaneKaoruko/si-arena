import type { GameCatalogEntry } from "@si-arena/protocol";
import { royaleMapSize } from "../constants";

export { ROYALE_PALETTE } from "./palette";

export { drawRoyaleBoard, royalePlayerSummaries, type RoyaleBoardAnimation } from "./board";

export const royalePresentation = {
  id: "royale",
  headline: "多人圈地，活到最后",
  instructions: Object.freeze([
    "最多五人同场，每 tick 选择一个移动方向，或原地停留。",
    "离开领地会留下尾迹，安全返回领地即可占领围住的区域。",
    "尾迹被踩中、被别人圈住，或撞头、越界、留在安全区外，都会立即出局。",
    "安全区随淘汰向中心收缩；最后存活者获胜，回合耗尽时存活者按领地面积排名。",
  ]),
  getStats(game: GameCatalogEntry) {
    return [
      { label: "参赛人数", value: `${game.minPlayers}–${game.maxPlayers}` },
      {
        label: "地图尺寸",
        value: `${royaleMapSize(game.minPlayers)}–${royaleMapSize(game.maxPlayers)} 见方`,
      },
      { label: "回合上限", value: String(game.maxTicks) },
      { label: "每 tick CPU", value: `${game.resolvedLimits.cpuMs} ms` },
    ];
  },
};
