import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import { BOMBER_CONFIG } from "./constants";
import { bomberCatalogEntry } from "./manifest";
import { bomberRules } from "./rules";
import { parseBomberObservation } from "./rules/observation";
import { viewBomberState } from "./rules/state";
import { readRecord } from "./rules/validation";
import type { BomberObservation, BomberState } from "./sdk";
export { BOMBER_SDK_SOURCE } from "./sdk/source";

type Seats = readonly { readonly id: string; readonly slot: number }[];
/** Every listed player sits in the match seat of its slot. */
const seated = (players: Seats, seats: Seats) =>
  players.every((player) => seats[player.slot]?.id === player.id);

/** Registered, trusted game definition. Importing it never loads renderer or bot code. */
export const bomberGame = {
  manifest: bomberCatalogEntry,
  rules: bomberRules,
  parseConfig(raw: unknown): JsonObject {
    const config = readRecord(raw, Object.keys(BOMBER_CONFIG), "Bomber config");
    if (Object.entries(BOMBER_CONFIG).some(([key, value]) => config[key] !== value))
      throw new TypeError("Unsupported Bomber config");
    return { ...BOMBER_CONFIG };
  },
  parseState(
    raw: unknown,
    context: { config: DeepReadonly<JsonObject>; players: Seats },
  ): BomberState {
    const state = viewBomberState(raw);
    if (
      state.players.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(state.players, context.players)
    )
      throw new TypeError("Bomber state participants differ from match slots");
    // The engine snapshots parser output at once, so snapshot grids are shared, not copied.
    return state as BomberState;
  },
  parseObservation(
    raw: unknown,
    context: {
      config: DeepReadonly<JsonObject>;
      players: Seats;
      playerId: string;
      tick: number;
    },
  ): BomberObservation {
    const observation = parseBomberObservation(raw);
    if (
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId ||
      observation.players.length + observation.eliminated.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(observation.players, context.players) ||
      !seated(observation.eliminated, context.players)
    )
      throw new TypeError("Bomber observation participants or tick mismatch");
    return observation as BomberObservation;
  },
};

export const officialBotUrl = new URL("../bots/official.js", import.meta.url);

export const developmentFiles = {
  prompt: new URL("../PROMPT.md", import.meta.url),
  sdk: new URL("../SDK.md", import.meta.url),
  template: new URL("../bots/template.js", import.meta.url),
};
