import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import { TANK_CONFIG } from "./constants";
import { tankCatalogEntry } from "./manifest";
import { tankRules } from "./rules";
import { parseTankObservation } from "./rules/observation";
import { viewTankState } from "./rules/state";
import { readRecord } from "./rules/validation";
import type { TankObservation, TankState } from "./sdk";
export { TANK_SDK_SOURCE } from "./sdk/source";

type Seats = readonly { readonly id: string; readonly slot: number }[];
/** Every listed tank sits in the match seat of its slot. */
const seated = (tanks: Seats, seats: Seats) =>
  tanks.every((tank) => seats[tank.slot]?.id === tank.id);

/** Registered, trusted game definition. Importing it never loads renderer or bot code. */
export const tankGame = {
  manifest: tankCatalogEntry,
  rules: tankRules,
  parseConfig(raw: unknown): JsonObject {
    const config = readRecord(raw, Object.keys(TANK_CONFIG), "Tank config");
    if (Object.entries(TANK_CONFIG).some(([key, value]) => config[key] !== value))
      throw new TypeError("Unsupported Tank config");
    return { ...TANK_CONFIG };
  },
  parseState(
    raw: unknown,
    context: { config: DeepReadonly<JsonObject>; players: Seats },
  ): TankState {
    const state = viewTankState(raw);
    if (
      state.tanks.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(state.tanks, context.players)
    )
      throw new TypeError("Tank state participants differ from match slots");
    // The engine snapshots parser output at once, so snapshot terrain is shared, not copied.
    return state as TankState;
  },
  parseObservation(
    raw: unknown,
    context: {
      config: DeepReadonly<JsonObject>;
      players: Seats;
      playerId: string;
      tick: number;
    },
  ): TankObservation {
    const observation = parseTankObservation(raw);
    if (
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId ||
      observation.tanks.length + observation.eliminated.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(observation.tanks, context.players)
    )
      throw new TypeError("Tank observation participants or tick mismatch");
    return observation as TankObservation;
  },
};

export const officialBotUrl = new URL("../bots/official.js", import.meta.url);

export const developmentFiles = {
  prompt: new URL("../PROMPT.md", import.meta.url),
  sdk: new URL("../SDK.md", import.meta.url),
  template: new URL("../bots/template.js", import.meta.url),
};
