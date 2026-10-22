import type { ActionParseResult } from "@si-arena/protocol";
import type { SnakeAction } from "../sdk";
import { readRecord } from "./validation";

export function parseSnakeAction(raw: unknown): ActionParseResult<SnakeAction> {
  try {
    if (raw === null || typeof raw !== "object") throw new TypeError("Action must be an object");
    const value = readRecord(raw, ["type", "direction"], "move action");
    const direction = value.direction;
    if (
      value.type === "move" &&
      (direction === "up" || direction === "right" || direction === "down" || direction === "left")
    ) {
      return { ok: true, action: { type: "move", direction } };
    }
    throw new TypeError("Action must be move with a cardinal direction");
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid Snake action" };
  }
}
