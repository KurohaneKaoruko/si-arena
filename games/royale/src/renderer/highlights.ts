import type { DeepReadonly } from "@si-arena/protocol";
import type { RoyaleDeathCause, RoyaleEvent } from "../sdk";

const CAUSES: Record<RoyaleDeathCause, string> = {
  boundary: "越界",
  "head-collision": "撞头",
  "head-swap": "迎面换位",
  "self-trail": "踩到自己的尾迹",
  "trail-cut": "尾迹被切断",
  enclosed: "尾迹被圈住",
  zone: "留在安全区外",
};

/** Feed lines for one tick: eliminations (with the attacker of a cut) and zone shrinks. */
export function royaleHighlights(
  events: DeepReadonly<RoyaleEvent[]>,
  names: ReadonlyMap<string, string>,
): Array<{ text: string; tone: "danger" | "neutral" }> {
  const name = (id: string) => names.get(id) ?? id;
  const lines: Array<{ text: string; tone: "danger" | "neutral" }> = [];
  for (const event of events) {
    if (event.type === "zone-shrink")
      lines.push({ text: `安全区收缩到 ${event.size}×${event.size}`, tone: "neutral" });
    if (event.type !== "death") continue;
    const cutters = events.flatMap((other) =>
      other.type === "trail-cut" && other.playerId === event.playerId ? [other.attackerId] : [],
    );
    const causes = event.causes.map((cause) => CAUSES[cause]).join("、");
    const by = cutters.length ? `，切断者 ${cutters.map(name).join("、")}` : "";
    lines.push({ text: `${name(event.playerId)} 出局：${causes}${by}`, tone: "danger" });
  }
  return lines;
}
