import type { ActionParseResult } from "@si-arena/protocol";
import type { TankAction } from "../sdk";
import { readRecord } from "./validation";

export function parseTankAction(raw: unknown): ActionParseResult<TankAction> {
  try {
    if (raw === null || typeof raw !== "object") throw new TypeError("Action must be an object");
    const type = Object.getOwnPropertyDescriptor(raw, "type")?.value as unknown;
    if (type === "idle" || type === "fire") {
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
    throw new TypeError("Action must be idle, fire or move with a cardinal direction");
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid Tank action" };
  }
}
