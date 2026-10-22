import type { DeepReadonly } from "@si-arena/protocol";
import type { BomberDeathCause, BomberEvent } from "../sdk";

const CAUSES: Record<BomberDeathCause, string> = {
  flame: "被火焰波及",
  collapse: "被坍塌压住",
};
const KINDS = { fire: "火焰道具", bomb: "炸弹道具" } as const;

/** Feed lines for one tick: wall-breaking explosions, pickups, collapses and eliminations. */
export function bomberHighlights(
  events: DeepReadonly<BomberEvent[]>,
  names: ReadonlyMap<string, string>,
): Array<{ text: string; tone: "danger" | "neutral" }> {
  const name = (id: string) => names.get(id) ?? id;
  const lines: Array<{ text: string; tone: "danger" | "neutral" }> = [];
  for (const event of events) {
    if (event.type === "explosion" && event.destroyed.length > 0) {
      const owners = [...new Set(event.bombs.map((bomb) => bomb.ownerId))].map(name);
      lines.push({
        text: `${owners.join("、")} 的炸弹炸开 ${event.destroyed.length} 面软墙`,
        tone: "neutral",
      });
    } else if (event.type === "pickup") {
      lines.push({ text: `${name(event.playerId)} 拾取${KINDS[event.kind]}`, tone: "neutral" });
    } else if (event.type === "collapse") {
      lines.push({ text: `第 ${event.ring} 圈坍塌`, tone: "neutral" });
    } else if (event.type === "death") {
      const causes = event.causes.map((cause) => CAUSES[cause]).join("、");
      const by = event.killerIds.length ? `，击杀者 ${event.killerIds.map(name).join("、")}` : "";
      lines.push({ text: `${name(event.playerId)} 出局：${causes}${by}`, tone: "danger" });
    }
  }
  return lines;
}
