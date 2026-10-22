import type { DeepReadonly, JsonObject } from "@si-arena/protocol";
import { SNAKE_CONFIG } from "./constants";
import { snakeCatalogEntry } from "./manifest";
import { snakeRules } from "./rules";
import { parseSnakeObservation } from "./rules/observation";
import { viewSnakeState } from "./rules/state";
import { readRecord } from "./rules/validation";
import type { SnakeObservation, SnakeState } from "./sdk";
export { SNAKE_SDK_SOURCE } from "./sdk/source";

type Seats = readonly { readonly id: string; readonly slot: number }[];
/** Every listed player sits in the match seat of its slot. */
const seated = (players: Seats, seats: Seats) =>
  players.every((player) => seats[player.slot]?.id === player.id);

/** Registered, trusted game definition. Importing it never loads renderer or bot code. */
export const snakeGame = {
  manifest: snakeCatalogEntry,
  rules: snakeRules,
  parseConfig(raw: unknown): JsonObject {
    const config = readRecord(raw, Object.keys(SNAKE_CONFIG), "Snake config");
    if (Object.entries(SNAKE_CONFIG).some(([key, value]) => config[key] !== value))
      throw new TypeError("Unsupported Snake config");
    return { ...SNAKE_CONFIG };
  },
  parseState(
    raw: unknown,
    context: { config: DeepReadonly<JsonObject>; players: Seats },
  ): SnakeState {
    const state = viewSnakeState(raw);
    if (
      state.snakes.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(state.snakes, context.players)
    )
      throw new TypeError("Snake state participants differ from match slots");
    // The engine snapshots parser output at once, so snapshot lists are shared, not copied.
    return state as SnakeState;
  },
  parseObservation(
    raw: unknown,
    context: {
      config: DeepReadonly<JsonObject>;
      players: Seats;
      playerId: string;
      tick: number;
    },
  ): SnakeObservation {
    const observation = parseSnakeObservation(raw);
    if (
      observation.tick !== context.tick ||
      observation.selfId !== context.playerId ||
      observation.snakes.length + observation.eliminated.length !== context.players.length ||
      context.players.some((seat, slot) => seat.slot !== slot) ||
      !seated(observation.snakes, context.players) ||
      !seated(observation.eliminated, context.players)
    )
      throw new TypeError("Snake observation participants or tick mismatch");
    return observation as SnakeObservation;
  },
};

export const officialBotUrl = new URL("../bots/official.js", import.meta.url);

export const developmentFiles = {
  prompt: new URL("../PROMPT.md", import.meta.url),
  sdk: new URL("../SDK.md", import.meta.url),
  template: new URL("../bots/template.js", import.meta.url),
};
