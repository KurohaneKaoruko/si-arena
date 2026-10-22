import type { ActionParseResult } from "@si-arena/protocol";
import type { BomberAction } from "../sdk";
import { readRecord } from "./validation";

export function parseBomberAction(raw: unknown): ActionParseResult<BomberAction> {
  try {
    if (raw === null || typeof raw !== "object") throw new TypeError("Action must be an object");
    const type = Object.getOwnPropertyDescriptor(raw, "type")?.value as unknown;
    if (type === "idle" || type === "bomb") {
      readRecord(raw, ["type"], `${type} action`);
      return { ok: true, action: { type } };
    }
    const value = readRecord(raw, ["type", "direction"], "move action");
    const direction = value.direction;
    if (
      value.type === "move" &&
      (direction === "up" || direction === "right" || direction === "down" || direction === "left")
    ) {
      return { ok: true, action: { type: "move", direction } };
    }
    throw new TypeError("Action must be idle, bomb or move with a cardinal direction");
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid Bomber action" };
  }
}
