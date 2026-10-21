import type { GameCatalogEntry } from "@si-arena/protocol";

/** One-line explanation of how a game's board is ordered, derived from its manifest. */
export function leaderboardBlurb(game: GameCatalogEntry): string {
  if (!game.arena)
    return "按 Elo 排位分实时排序。练习、挑战与官方 bot 的比赛不计分，官方 bot 不上榜。";
  const points = game.arena.points
    .map((value, index) => ({ value, rank: index + 1 }))
    .filter(({ value }) => value > 0)
    .map(({ value, rank }) => `第 ${rank} 名 ${value} 分`);
  return `按积分实时排序，前 ${game.arena.seats} 名进入下一局。积分规则：${points.join("，")}。`;
}
