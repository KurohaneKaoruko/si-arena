import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import { paperCatalogEntry } from "./manifest";
import { paperRules, parsePaperState } from "./rules";
import { readRecord } from "./rules/validation";
import { parsePaperObservation } from "./rules/observation";
import { PAPER_CONFIG } from "./constants";
import type { PaperObservation } from "./sdk";
export { PAPER_SDK_SOURCE } from "./sdk/source";

/** Registered, trusted game definition. Importing it never loads renderer or bot code. */
export const paperGame = {
  manifest: paperCatalogEntry,
  rules: paperRules,
  parseConfig(raw: unknown): JsonObject {
    const config = readRecord(raw, Object.keys(PAPER_CONFIG), "Paper config");
    if (Object.entries(PAPER_CONFIG).some(([key, value]) => config[key] !== value))
      throw new TypeError("Unsupported Paper config");
    return { ...PAPER_CONFIG };
  },
  parseState(
    raw: unknown,
    context: {
      config: DeepReadonly<JsonObject>;
      players: readonly { readonly id: string; readonly slot: number }[];
    },
  ) {
    const state = parsePaperState(raw);
    if (
      context.players.length !== 2 ||
      state.players.some(
        (player, index) =>
          player.id !== context.players[index]?.id || player.slot !== context.players[index]?.slot,
      )
    )
      throw new TypeError("Paper state participants differ from match slots");
    return state;
  },
  parseObservation(
    raw: unknown,
    context: {
      config: DeepReadonly<JsonObject>;
      players: readonly { readonly id: string; readonly slot: number }[];
      playerId: string;
      tick: number;
    },
  ): PaperObservation {
    const observation = parsePaperObservation(raw);
    if (
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId ||
      observation.players.some(
        (p, i) => p.id !== context.players[i]?.id || p.slot !== context.players[i]?.slot,
      ) ||
      context.players.length !== 2
    )
      throw new TypeError("Paper observation participants or tick mismatch");
    return observation;
  },
};

export const officialBotUrl = new URL("../bots/official.js", import.meta.url);

export const developmentFiles = {
  prompt: new URL("../PROMPT.md", import.meta.url),
  sdk: new URL("../SDK.md", import.meta.url),
  template: new URL("../bots/template.js", import.meta.url),
};
