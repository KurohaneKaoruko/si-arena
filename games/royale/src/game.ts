import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import { ROYALE_CONFIG } from "./constants";
import { royaleCatalogEntry } from "./manifest";
import { royaleRules } from "./rules";
import { parseRoyaleObservation } from "./rules/observation";
import { viewRoyaleState } from "./rules/state";
import { readRecord } from "./rules/validation";
import type { RoyaleObservation, RoyaleState } from "./sdk";
export { ROYALE_SDK_SOURCE } from "./sdk/source";

type Seats = readonly { readonly id: string; readonly slot: number }[];
/** Every listed player sits in the match seat of its slot. */
const seated = (players: Seats, seats: Seats) =>
  players.every((player) => seats[player.slot]?.id === player.id);

/** Registered, trusted game definition. Importing it never loads renderer or bot code. */
export const royaleGame = {
  manifest: royaleCatalogEntry,
  rules: royaleRules,
  parseConfig(raw: unknown): JsonObject {
    const config = readRecord(raw, Object.keys(ROYALE_CONFIG), "Royale config");
    if (Object.entries(ROYALE_CONFIG).some(([key, value]) => config[key] !== value))
      throw new TypeError("Unsupported Royale config");
    return { ...ROYALE_CONFIG };
  },
  parseState(
    raw: unknown,
    context: { config: DeepReadonly<JsonObject>; players: Seats },
  ): RoyaleState {
    const state = viewRoyaleState(raw);
    if (
      state.players.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(state.players, context.players)
    )
      throw new TypeError("Royale state participants differ from match slots");
    // The engine snapshots parser output at once, so snapshot grids are shared, not copied.
    return state as RoyaleState;
  },
  parseObservation(
    raw: unknown,
    context: {
      config: DeepReadonly<JsonObject>;
      players: Seats;
      playerId: string;
      tick: number;
    },
  ): RoyaleObservation {
    const observation = parseRoyaleObservation(raw);
    if (
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId ||
      observation.players.length + observation.eliminated.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(observation.players, context.players) ||
      !seated(observation.eliminated, context.players)
    )
      throw new TypeError("Royale observation participants or tick mismatch");
    return observation as RoyaleObservation;
  },
};

export const officialBotUrl = new URL("../bots/official.js", import.meta.url);

export const developmentFiles = {
  prompt: new URL("../PROMPT.md", import.meta.url),
  sdk: new URL("../SDK.md", import.meta.url),
  template: new URL("../bots/template.js", import.meta.url),
};
