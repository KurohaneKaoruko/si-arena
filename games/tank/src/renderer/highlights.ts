import type { DeepReadonly } from "@si-arena/protocol";
import type { TankEvent } from "../sdk";

/** Feed lines for one tick: hits with the remaining hp, bricks broken, and deaths. */
export function tankHighlights(
  events: DeepReadonly<TankEvent[]>,
  names: ReadonlyMap<string, string>,
): Array<{ text: string; tone: "danger" | "neutral" }> {
  const name = (id: string) => names.get(id) ?? id;
  const lines: Array<{ text: string; tone: "danger" | "neutral" }> = [];
  for (const event of events) {
    if (event.type === "hit")
      lines.push({
        text: `${name(event.attackerId)} 命中 ${name(event.playerId)}，剩余 ${event.hp} 点生命`,
        tone: "danger",
      });
    else if (event.type === "brick-destroyed")
      lines.push({
        text: `${name(event.attackerId)} 打穿了 ${event.cells.length} 块砖墙`,
        tone: "neutral",
      });
    else if (event.type === "death")
      lines.push({ text: `${name(event.playerId)} 被击毁`, tone: "danger" });
  }
  return lines;
}
