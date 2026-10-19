import type { GameCatalogEntry } from "@si-arena/protocol";

export { PAPER_PALETTE } from "./palette";

export { drawPaperBoard, paperPlayerSummaries, type PaperBoardAnimation } from "./board";

export const paperPresentation = {
  id: "paper",
  headline: "圈地、回城、截击",
  instructions: Object.freeze([
    "每 tick 选择一个移动方向，或原地停留。",
    "离开领地会留下尾迹，安全返回领地即可占领围住的区域。",
    "切断对手尾迹可以淘汰对手，自己的尾迹也需要保护。",
    "单独存活立即获胜；回合耗尽时比较领地面积。",
  ]),
  getStats(game: GameCatalogEntry) {
    return [
      { label: "参赛人数", value: String(game.minPlayers) },
      { label: "地图尺寸", value: `${game.config.width}×${game.config.height}` },
      { label: "回合上限", value: String(game.maxTicks) },
      { label: "每 tick CPU", value: `${game.resolvedLimits.cpuMs} ms` },
    ];
  },
};
