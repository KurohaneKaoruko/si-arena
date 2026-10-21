import type { ActionParseResult } from "@si-arena/protocol";
import type { RoyaleAction } from "../sdk";
import { readRecord } from "./validation";

export function parseRoyaleAction(raw: unknown): ActionParseResult<RoyaleAction> {
  try {
    if (raw === null || typeof raw !== "object") throw new TypeError("Action must be an object");
    const type = Object.getOwnPropertyDescriptor(raw, "type")?.value as unknown;
    if (type === "idle") {
      readRecord(raw, ["type"], "idle action");
      return { ok: true, action: { type: "idle" } };
    }
    const value = readRecord(raw, ["type", "direction"], "move action");
    const direction = value.direction;
    if (
      value.type === "move" &&
      (direction === "up" || direction === "right" || direction === "down" || direction === "left")
    ) {
      return { ok: true, action: { type: "move", direction } };
    }
    throw new TypeError("Action must be idle or move with a cardinal direction");
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid Royale action" };
  }
}
