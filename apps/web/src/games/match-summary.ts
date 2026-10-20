import type { MatchParticipantSummary, MatchSummary } from "@si-arena/protocol";

export function ratingDelta(player: MatchParticipantSummary | undefined): string {
  if (player?.ratingBefore === undefined || player.ratingAfter === undefined) return "—";
  const value = Math.round((player.ratingAfter - player.ratingBefore) * 100) / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

export function matchOutcome(match: MatchSummary, userId?: string) {
  if (match.status === "pending") return { label: "等待开局", tone: "warning" } as const;
  if (match.status === "running") return { label: "进行中", tone: "accent" } as const;
  if (match.status === "failed") return { label: "系统失败", tone: "danger" } as const;
  const self = match.participants.find((p) => p.userId === userId);
  const ranks = match.participants.map((p) => p.rank);
  if (self?.rank === undefined || ranks.some((rank) => rank === undefined))
    return { label: "已完成", tone: "neutral" } as const;
  const best = Math.min(...(ranks as number[]));
  if (ranks.every((rank) => rank === self.rank)) return { label: "平局", tone: "neutral" } as const;
  if (self.rank === best) return { label: "获胜", tone: "success" } as const;
  return {
    label: match.participants.length === 2 ? "失利" : `第 ${self.rank} 名`,
    tone: "danger",
  } as const;
}
