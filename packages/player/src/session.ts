import {
  cloneJson,
  freezeJson,
  stringifyJson,
  utf8Bytes,
  type DeepReadonly,
  type JsonValue,
  type Replay,
} from "@si-arena/protocol";
import {
  parseGameState,
  replayMatch,
  type GameDefinition,
  type ReplayTick,
  type StateContext,
} from "@si-arena/engine";

export const REPLAY_MAX_BYTES = 64 * 1024 * 1024;
export interface ReplayFrame<State, Action, Event> {
  state: DeepReadonly<State>;
  previousState: DeepReadonly<State>;
  events: DeepReadonly<Event[]>;
  record: DeepReadonly<ReplayTick<Action>> | null;
}
export interface SessionOptions {
  signal?: AbortSignal;
  onProgress?(completedTicks: number): void;
  yieldControl?(): Promise<void>;
  cacheBytes?: number;
}

/** Validates the complete match before making any state or diagnostic available to UI. */
export async function createReplaySession<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(
  raw: unknown,
  suppliedGame: GameDefinition<State, Observation, Action, Event>,
  options: SessionOptions = {},
) {
  const cancelled = () => {
    if (options.signal?.aborted) throw new Error("回放加载已取消");
  };
  cancelled();
  const game = {
    ...suppliedGame,
    manifest: cloneJson(suppliedGame.manifest),
    rules: { ...suppliedGame.rules },
  };
  const value = cloneJson(raw, REPLAY_MAX_BYTES);
  const cache = new Map<number, { state: DeepReadonly<State>; bytes: number }>();
  const budget = options.cacheBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(budget) || budget <= 0)
    throw new RangeError("Invalid playback cache budget");
  let cachedBytes = 0;
  const remember = (state: DeepReadonly<State>) => {
    if (cache.has(state.tick)) return;
    const bytes = utf8Bytes(stringifyJson(state, { maxBytes: REPLAY_MAX_BYTES }));
    if (bytes > budget) {
      if (state.tick === 0) throw new RangeError("Initial world exceeds playback cache budget");
      return;
    }
    while (cache.size >= 16 || cachedBytes + bytes > budget) {
      const oldest = [...cache.keys()].find((tick) => tick !== 0);
      if (oldest === undefined) return;
      cachedBytes -= cache.get(oldest)!.bytes;
      cache.delete(oldest);
    }
    cache.set(state.tick, { state, bytes });
    cachedBytes += bytes;
  };
  await replayMatch(value, game, {
    maxBytes: REPLAY_MAX_BYTES,
    async onTick({ state }) {
      cancelled();
      if (state.tick % 50 === 0) {
        remember(state);
        options.onProgress?.(state.tick);
        await options.yieldControl?.();
        cancelled();
      }
    },
  });
  cancelled();
  // The engine has checked every field of this detached JSON snapshot.
  const replay = freezeJson(value as Replay<State, Action>);
  const context: StateContext = freezeJson({
    config: cloneJson(replay.config),
    players: replay.players.toSorted((a, b) => a.slot - b.slot),
  });
  const initial = parseGameState(game, replay.initialState, 0, context);
  // Reserve S0 first, evicting intermediate checkpoints if needed.
  const candidates = [...cache.values()];
  cache.clear();
  cachedBytes = 0;
  remember(initial);
  for (const candidate of candidates) remember(candidate.state);
  const errorTicks = Object.freeze(
    replay.ticks.filter((tick) => Object.keys(tick.errors ?? {}).length).map((tick) => tick.tick),
  );
  let last: ReplayFrame<State, Action, Event> = Object.freeze({
    state: initial,
    previousState: initial,
    events: [],
    record: null,
  });
  const frame = (completedTicks: number): ReplayFrame<State, Action, Event> => {
    if (
      !Number.isSafeInteger(completedTicks) ||
      completedTicks < 0 ||
      completedTicks > replay.ticks.length
    )
      throw new RangeError("Invalid completed tick");
    if (last.state.tick === completedTicks) return last;
    if (completedTicks === 0)
      return (last = Object.freeze({
        state: initial,
        previousState: initial,
        events: [],
        record: null,
      }));
    let state = initial;
    for (const [tick, entry] of cache) {
      if (tick < completedTicks && tick > state.tick) state = entry.state;
    }
    if (last.state.tick < completedTicks && last.state.tick > state.tick) state = last.state;
    if (cache.has(state.tick) && state.tick !== 0) {
      const entry = cache.get(state.tick)!;
      cache.delete(state.tick);
      cache.set(state.tick, entry);
    }
    while (state.tick < completedTicks) {
      const record = replay.ticks[state.tick]!;
      const output = game.rules.step(state, record.actions);
      const next = parseGameState(game, output.nextState, state.tick + 1, context);
      const events = freezeJson(cloneJson(output.events));
      last = Object.freeze({ state: next, previousState: state, events, record });
      state = next;
      if (state.tick % 50 === 0) remember(state);
    }
    return last;
  };
  return {
    replay,
    errorTicks,
    frame,
    observation(completedTicks: number, playerId: string): Observation | null {
      const current = frame(completedTicks);
      return game.rules.observe(current.previousState, playerId);
    },
    get cacheInfo() {
      return { count: cache.size, bytes: cachedBytes };
    },
  };
}
