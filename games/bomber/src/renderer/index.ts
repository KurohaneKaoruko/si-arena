import type { GameCatalogEntry } from "@si-arena/protocol";
import { BOMBER_HEIGHT, BOMBER_WIDTH } from "../constants";

export { BOMBER_PALETTE } from "./palette";

export { drawBomberBoard, bomberPlayerSummaries, type BomberBoardAnimation } from "./board";
export { bomberHighlights } from "./highlights";

export const bomberPresentation = {
  id: "bomber",
  headline: "炸墙拾宝，困敌于火",
  instructions: Object.freeze([
    "最多四人同场，每 tick 选择移动一格、在脚下放炸弹，或原地停留。",
    "炸弹 8 tick 后爆炸，火焰向四方延伸，炸开软墙并露出火力或炸弹道具；火焰会引爆别的炸弹。",
    "被火焰波及立即出局；从第 300 tick 起地图每 8 tick 由外向内坍塌一圈，站在上面同样出局。",
    "最后存活者获胜，回合耗尽时存活者按得分排名：每面软墙 1 分，每次击杀 10 分。",
  ]),
  getStats(game: GameCatalogEntry) {
    return [
      { label: "参赛人数", value: `${game.minPlayers}–${game.maxPlayers}` },
      { label: "地图尺寸", value: `${BOMBER_WIDTH}×${BOMBER_HEIGHT}` },
      { label: "回合上限", value: String(game.maxTicks) },
      { label: "每 tick CPU", value: `${game.resolvedLimits.cpuMs} ms` },
    ];
  },
};
