import {
  cloneJson,
  freezeJson,
  utf8Bytes,
  type GameResult,
  type JsonValue,
  type ResourceLimits,
} from "@si-arena/protocol";
import {
  ReplayValidationError,
  type GameDefinition,
  type MatchSummary,
  type ReplayTick,
  type StateContext,
  type TickFrame,
} from "./types";
import {
  canonical,
  checkedState,
  gameHeader,
  parsedAction,
  parseError,
  parseLimits,
  parsePlayers,
  parseResources,
  parseResult,
  record,
  snapshotGame,
  stateHash,
  text,
} from "./validation";

export interface ReplayOptions<State, Action, Event> {
  maxBytes?: number;
  /**
   * Caller asserts raw is already a detached plain-JSON snapshot (for example the
   * output of cloneJson or JSON.parse). The engine validates it in place instead
   * of cloning, so loaders that keep their own copy pay for exactly one clone.
   * maxBytes is not re-checked in detached mode: the caller's snapshot was
   * already bounded when it was created.
   */
  detached?: boolean;
  onTick?(frame: TickFrame<State, Action, Event>): void | Promise<void>;
}

/** The caller supplies an already trusted release. No player code or remote modules are loaded. */
export async function replayMatch<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(
  raw: unknown,
  game: GameDefinition<State, Observation, Action, Event>,
  options: ReplayOptions<State, Action, Event> = {},
): Promise<MatchSummary<State>> {
  try {
    game = snapshotGame(game);
    const value =
      options.detached === true ? raw : cloneJson(raw, options.maxBytes ?? 32 * 1024 * 1024);
    const replay = record(value, "replay", [
      "formatVersion",
      "matchId",
      "game",
      "players",
      "config",
      "resolvedLimits",
      "initialState",
      "ticks",
      "result",
      "finalStateHash",
    ]);
    if (replay.formatVersion !== 1) throw new TypeError("Unsupported replay format");
    text(replay.matchId, "matchId");
    const release = record(replay.game, "game", [
      "id",
      "release",
      "botProtocolVersion",
      "engineCompatibility",
    ]);
    if (canonical(release) !== canonical(gameHeader(game)))
      throw new TypeError("Replay requires a different trusted game release or engine");
    const players = parsePlayers(
      replay.players,
      game.manifest.minPlayers,
      game.manifest.maxPlayers,
    );
    const limits = parseLimits(replay.resolvedLimits);
    if (canonical(limits) !== canonical(parseLimits(game.manifest.resolvedLimits)))
      throw new TypeError("Replay limits differ from the fixed release");
    const config = cloneJson(game.parseConfig(cloneJson(replay.config)));
    if (canonical(config) !== canonical(replay.config))
      throw new TypeError("Replay config is not normalized");
    const context: StateContext = freezeJson({ config, players });
    let state = checkedState(game, replay.initialState, 0, context);
    if (
      !Array.isArray(replay.ticks) ||
      replay.ticks.length === 0 ||
      replay.ticks.length > game.manifest.maxTicks
    )
      throw new TypeError("Invalid replay tick count");
    let terminal: GameResult | undefined;
    let matchLogBytes = 0;
    for (let tick = 0; tick < replay.ticks.length; tick++) {
      if (terminal) throw new TypeError("Replay contains actions after game termination");
      const entry = record(
        replay.ticks[tick],
        "tick",
        ["tick", "actions"],
        ["errors", "logs", "logsTruncated", "resources"],
      );
      if (entry.tick !== tick)
        throw new TypeError("Replay ticks must start at zero and be contiguous");
      const active = players.flatMap((player) => {
        const observation = game.rules.observe(state, player.id);
        if (observation === null) return [];
        cloneJson(
          game.parseObservation(cloneJson(observation, limits.observationBytes), {
            ...context,
            playerId: player.id,
            tick,
          }),
          limits.observationBytes,
        );
        return [player.id];
      });
      if (!active.length) throw new TypeError("Nonterminal replay has no active players");
      const rawActions = record(entry.actions, "actions", active);
      const actions = Object.create(null) as Record<string, Action>;
      for (const id of active) actions[id] = parsedAction(game, rawActions[id], limits);
      const diagnostics = checkDiagnostics(entry, active, limits);
      matchLogBytes += diagnostics.logBytes;
      if (matchLogBytes > limits.logs.matchBytes)
        throw new TypeError("Replay exceeds match log budget");
      const output = game.rules.step(state, freezeJson(cloneJson(actions)));
      state = checkedState(game, output.nextState, tick + 1, context);
      const events = freezeJson(cloneJson(output.events));
      if (!Array.isArray(events)) throw new TypeError("Invalid rule events");
      if (output.result !== undefined) terminal = parseResult(output.result, players, tick + 1);
      const saved = cloneJson(entry) as unknown as ReplayTick<Action>;
      await options.onTick?.({ state, events, record: freezeJson(saved) });
    }
    if (!terminal) throw new TypeError("Replay does not reach a terminal result");
    const expected = parseResult(replay.result, players, replay.ticks.length, true);
    if (canonical(expected) !== canonical(terminal))
      throw new TypeError("Replay result differs from replayed rules");
    if (typeof replay.finalStateHash !== "string" || !/^[0-9a-f]{64}$/.test(replay.finalStateHash))
      throw new TypeError("Invalid final state hash");
    const finalStateHash = await stateHash(state);
    if (finalStateHash !== replay.finalStateHash)
      throw new TypeError("Replay final state hash mismatch");
    return { result: terminal, finalState: state, finalStateHash };
  } catch (error) {
    if (error instanceof ReplayValidationError) throw error;
    throw new ReplayValidationError(error instanceof Error ? error.message : "Invalid replay");
  }
}

function checkDiagnostics(
  entry: Record<string, unknown>,
  active: readonly string[],
  limits: ResourceLimits,
): { logBytes: number } {
  let logBytes = 0;
  if (entry.errors !== undefined) {
    const errors = record(entry.errors, "errors", [], active);
    for (const value of Object.values(errors)) parseError(value, limits);
  }
  if (entry.logs !== undefined) {
    const logs = record(entry.logs, "logs", [], active);
    for (const raw of Object.values(logs)) {
      if (!Array.isArray(raw) || raw.length > limits.logs.tickLines)
        throw new TypeError("Invalid replay log count");
      let tickBytes = 0;
      for (const rawLog of raw) {
        const log = record(rawLog, "log", ["level", "message"]);
        if (
          typeof log.level !== "string" ||
          !["log", "info", "warn", "error", "debug"].includes(log.level) ||
          typeof log.message !== "string"
        )
          throw new TypeError("Invalid replay log");
        const bytes = utf8Bytes(log.message);
        if (bytes > limits.logs.lineBytes) throw new TypeError("Replay log line is too large");
        tickBytes += bytes;
      }
      if (tickBytes > limits.logs.tickBytes) throw new TypeError("Replay exceeds tick log budget");
      logBytes += tickBytes;
    }
  }
  if (entry.logsTruncated !== undefined) {
    const flags = record(entry.logsTruncated, "logsTruncated", [], active);
    if (Object.values(flags).some((flag) => flag !== true))
      throw new TypeError("Invalid logsTruncated marker");
  }
  if (entry.resources !== undefined) {
    const resources = record(entry.resources, "resources", [], active);
    for (const resource of Object.values(resources)) parseResources(resource);
  }
  return { logBytes };
}
