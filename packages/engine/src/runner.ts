import {
  cloneJson,
  freezeJson,
  snapshotJson,
  truncateUtf8,
  utf8Bytes,
  type DeepReadonly,
  type GameResult,
  type JsonValue,
  type PlayerLog,
} from "@si-arena/protocol";
import {
  EngineError,
  type ExecutorOutcome,
  type MatchOptions,
  type MatchSummary,
  type PlayerExecutor,
  type ReplayHeader,
  type ReplayTick,
  type StateContext,
} from "./types";
import {
  checkedState,
  gameHeader,
  integer,
  parsedAction,
  parseError,
  parseLimits,
  parsePlayers,
  parseResources,
  parseResult,
  snapshotGame,
  stateHash,
  text,
} from "./validation";

export async function runMatch<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(options: MatchOptions<State, Observation, Action, Event>): Promise<MatchSummary<State>> {
  const executors = new Map<string, PlayerExecutor<Observation, Action>>();
  const closing = new Map<PlayerExecutor<Observation, Action>, Promise<void>>();
  const closeAll = async () => {
    for (const executor of executors.values())
      if (!closing.has(executor))
        closing.set(
          executor,
          Promise.resolve().then(() => executor.close()),
        );
    const closed = await Promise.allSettled(closing.values());
    const failed = closed.find((item) => item.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  };
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new EngineError("Match cancelled");
  };
  const cancel = () => {
    void closeAll().catch(() => {});
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  let completed = false;
  try {
    checkCancelled();
    const game = snapshotGame(options.game);
    const captureLogs = options.captureLogs ?? false;
    const metadata = gameHeader(game);
    const players = parsePlayers(
      cloneJson(options.players),
      game.manifest.minPlayers,
      game.manifest.maxPlayers,
    );
    const limits = parseLimits(cloneJson(game.manifest.resolvedLimits));
    const config = cloneJson(game.parseConfig(cloneJson(options.config ?? game.manifest.config)));
    const context: StateContext = freezeJson({ config, players });
    const matchId = text(options.matchId, "matchId");
    const seed = integer(options.seed, 0, 0xffffffff, "seed");
    let state = checkedState(
      game,
      game.rules.init({
        seed,
        config: cloneJson(config),
        players: players.map(({ id, slot }) => ({ id, slot })),
      }),
      0,
      context,
    );
    const header: ReplayHeader<State> = {
      formatVersion: 1,
      matchId,
      game: metadata,
      players: cloneJson(players),
      config,
      resolvedLimits: limits,
      initialState: cloneJson(state) as State,
    };
    await options.sink.start(cloneJson(header));
    const creation = await Promise.allSettled(
      players.map(async (player) => {
        const executor = await options.createExecutor(Object.freeze({ ...player }), {
          matchId,
          limits: cloneJson(limits),
          captureLogs,
        });
        if (
          !executor ||
          typeof executor.execute !== "function" ||
          typeof executor.close !== "function"
        )
          throw new EngineError("Invalid executor adapter");
        if ([...executors.values()].includes(executor))
          throw new EngineError("Players require independent executor instances");
        executors.set(player.id, executor);
        if (options.signal?.aborted) await executor.close();
      }),
    );
    const startupFailure = creation.find((item) => item.status === "rejected");
    if (startupFailure?.status === "rejected") throw startupFailure.reason;
    checkCancelled();
    let matchLogBytes = 0;
    let result: GameResult | undefined;
    let previousEvents: DeepReadonly<Event[]> = freezeJson([] as Event[]);
    for (let tick = 0; tick < game.manifest.maxTicks; tick++) {
      checkCancelled();
      // Finish all observations/defaults before dispatching any player code.
      const active = players.flatMap((player) => {
        const observation = game.rules.observe(state, player.id, { events: previousEvents });
        if (observation === null) return [];
        // Snapshots share the frozen world grids instead of copying them per boundary.
        const snapshot = snapshotJson(
          game.parseObservation(snapshotJson(observation, limits.observationBytes), {
            ...context,
            playerId: player.id,
            tick,
          }),
          limits.observationBytes,
        );
        const fallback = parsedAction(game, game.rules.defaultAction(state, player.id), limits);
        return [{ player, observation: snapshot, fallback }];
      });
      if (!active.length) throw new EngineError("Nonterminal game has no active players");
      const settled = await Promise.allSettled(
        active.map(async (entry) => {
          const outcome = await executors
            .get(entry.player.id)!
            .execute(tick, entry.observation, cloneJson(entry.fallback));
          return { entry, outcome };
        }),
      );
      checkCancelled();
      const failure = settled.find((item) => item.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      const actions = Object.create(null) as Record<string, Action>;
      const errors = Object.create(null) as NonNullable<ReplayTick<Action>["errors"]>;
      const logs = Object.create(null) as NonNullable<ReplayTick<Action>["logs"]>;
      const logsTruncated = Object.create(null) as NonNullable<ReplayTick<Action>["logsTruncated"]>;
      const resources = Object.create(null) as NonNullable<ReplayTick<Action>["resources"]>;
      // Promise.allSettled preserves slot order, even when execution completes out of order.
      for (const item of settled) {
        if (item.status !== "fulfilled") throw new EngineError("Missing player execution");
        const { entry, outcome } = item.value;
        checkIdentity(outcome, matchId, entry.player.id, tick);
        if (outcome.ok) {
          if (outcome.error !== undefined)
            throw new EngineError("Successful executor output cannot contain an error");
          actions[entry.player.id] = parsedAction(game, outcome.action, limits);
        } else {
          actions[entry.player.id] = cloneJson(entry.fallback);
          errors[entry.player.id] = parseError(outcome.error, limits);
        }
        if (outcome.resources !== undefined) {
          const usage = parseResources(outcome.resources);
          if (outcome.ok && usage.cpuUsedUs !== undefined && usage.cpuUsedUs > limits.cpuMs * 1000)
            throw new EngineError("Executor committed an over-budget result");
          if (Object.keys(usage).length) resources[entry.player.id] = usage;
        }
        if (captureLogs) {
          let tickBytes = 0;
          const captured: PlayerLog[] = [];
          if (outcome.logs !== undefined && !Array.isArray(outcome.logs))
            throw new EngineError("Malformed executor logs");
          for (const log of outcome.logs ?? []) {
            if (
              typeof log.message !== "string" ||
              !["log", "info", "warn", "error", "debug"].includes(log.level)
            )
              throw new EngineError("Malformed executor log entry");
            if (
              captured.length >= limits.logs.tickLines ||
              tickBytes >= limits.logs.tickBytes ||
              matchLogBytes >= limits.logs.matchBytes
            ) {
              logsTruncated[entry.player.id] = true;
              break;
            }
            const message = truncateUtf8(
              log.message,
              Math.min(
                limits.logs.lineBytes,
                limits.logs.tickBytes - tickBytes,
                limits.logs.matchBytes - matchLogBytes,
              ),
            );
            if (message !== log.message) logsTruncated[entry.player.id] = true;
            captured.push({ level: log.level, message });
            const bytes = utf8Bytes(message);
            tickBytes += bytes;
            matchLogBytes += bytes;
          }
          if (captured.length) logs[entry.player.id] = captured;
          if (outcome.logsTruncated) logsTruncated[entry.player.id] = true;
        }
      }
      const record: ReplayTick<Action> = { tick, actions };
      if (Object.keys(errors).length) record.errors = errors;
      if (Object.keys(logs).length) record.logs = logs;
      if (Object.keys(logsTruncated).length) record.logsTruncated = logsTruncated;
      if (Object.keys(resources).length) record.resources = resources;
      const stepped = game.rules.step(state, snapshotJson(actions));
      state = checkedState(game, stepped.nextState, tick + 1, context);
      const events = snapshotJson(stepped.events);
      if (!Array.isArray(events)) throw new EngineError("Rules must return a JSON event array");
      previousEvents = events;
      if (stepped.result !== undefined) result = parseResult(stepped.result, players, tick + 1);
      if (!result && tick + 1 === game.manifest.maxTicks)
        throw new EngineError("Rules did not terminate within maxTicks");
      // Persist only complete ticks; an exception in trusted rules never becomes player failure.
      await options.sink.append(cloneJson(record));
      await options.onTick?.({ state, events, record: snapshotJson(record) });
      if (result) break;
    }
    checkCancelled();
    if (!result) throw new EngineError("Missing terminal result");
    const finalStateHash = await stateHash(state);
    await closeAll();
    checkCancelled();
    await options.sink.finish({ result: cloneJson(result), finalStateHash });
    completed = true;
    return { result: cloneJson(result), finalState: state, finalStateHash };
  } catch (error) {
    await options.sink.abort().catch(() => {});
    if (error instanceof EngineError) throw error;
    throw new EngineError(
      error instanceof Error ? error.message : "Trusted match execution failed",
    );
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    if (!completed) await closeAll().catch(() => {});
  }
}

function checkIdentity<Action>(
  outcome: ExecutorOutcome<Action>,
  matchId: string,
  playerId: string,
  tick: number,
): void {
  if (
    !outcome ||
    typeof outcome.ok !== "boolean" ||
    outcome.matchId !== matchId ||
    outcome.playerId !== playerId ||
    outcome.tick !== tick ||
    typeof outcome.executionId !== "string" ||
    !outcome.executionId
  )
    throw new EngineError("Stale, mismatched or invalid executor result");
}
