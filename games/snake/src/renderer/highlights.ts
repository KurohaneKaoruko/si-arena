import type { DeepReadonly } from "@si-arena/protocol";
import type { SnakeDeathCause, SnakeEvent } from "../sdk";

const CAUSES: Record<SnakeDeathCause, string> = {
  boundary: "越界",
  starvation: "饿死",
  "body-collision": "撞到蛇身",
  "head-collision": "头对头相撞",
};

/** Feed lines for one tick: meals and eliminations with their causes. */
export function snakeHighlights(
  events: DeepReadonly<SnakeEvent[]>,
  names: ReadonlyMap<string, string>,
): Array<{ text: string; tone: "danger" | "neutral" }> {
  const name = (id: string) => names.get(id) ?? id;
  const lines: Array<{ text: string; tone: "danger" | "neutral" }> = [];
  for (const event of events) {
    if (event.type === "eat")
      lines.push({ text: `${name(event.playerId)} 吃到食物`, tone: "neutral" });
    if (event.type !== "death") continue;
    const causes = event.causes.map((cause) => CAUSES[cause]).join("、");
    lines.push({ text: `${name(event.playerId)} 出局：${causes}`, tone: "danger" });
  }
  return lines;
}
