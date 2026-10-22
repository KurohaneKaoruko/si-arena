import type { GameCatalogEntry } from "@si-arena/protocol";

export { TANK_PALETTE } from "./palette";

export { drawTankBoard, tankPlayerSummaries, type TankBoardAnimation } from "./board";
export { tankHighlights } from "./highlights";

export const tankPresentation = {
  id: "tank",
  headline: "穿墙、走位、三发定胜负",
  instructions: Object.freeze([
    "两辆坦克在中心对称的迷宫里对决，每 tick 可以转向并前进一格、开火或停留。",
    "炮弹每 tick 飞两格，打穿砖墙、被钢墙挡下；两枚炮弹迎面相遇会同时消失。",
    "每辆坦克 3 点生命，同一时间只能有一枚炮弹在飞；先被打到 0 点的一方落败。",
    "打满 600 tick 时生命多者获胜，相同则并列。",
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
