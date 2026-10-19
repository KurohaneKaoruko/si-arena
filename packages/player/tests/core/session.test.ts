import { expect, test } from "vitest";
import { replayMatch, stateHash } from "@si-arena/engine";
import { createReplaySession } from "../../src";
import { counterGame, fixture, type State } from "../fixture";
import type { DeepReadonly } from "@si-arena/protocol";

test("initial worlds and checkpoint seeks use the engine's state normalization and slot context", async () => {
  const base = counterGame(105);
  const game: typeof base = {
    ...base,
    parseState(raw, context) {
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.config)).toBe(true);
      expect(context.players.map((player) => player.slot)).toEqual([0, 1]);
      const state = base.parseState(raw, context);
      return { ...state, counter: Math.floor(state.counter / 2) * 2 };
    },
  };
  const { replay } = await fixture(105, game);
  // The engine accepts this representation after normalizing S0 and sorting metadata slots.
  replay.initialState.counter = 1;
  replay.players.reverse();
  const expected = new Map<number, DeepReadonly<State>>();
  const verified = await replayMatch(replay, game, {
    onTick: ({ state }) => {
      expected.set(state.tick, state);
    },
  });
  const session = await createReplaySession(replay, game);
  expect(session.frame(0).state.counter).toBe(0);
  for (const tick of [1, 49, 50, 51, 104, 105, 3, 0, 100, 50, 105]) {
    const frame = session.frame(tick);
    if (tick === 0) expect(frame.state.counter).toBe(0);
    else expect(frame.state).toEqual(expected.get(tick));
    expect(frame.previousState.counter).toBe(tick <= 1 ? 0 : expected.get(tick - 1)!.counter);
  }
  expect(await stateHash(session.frame(105).state)).toBe(verified.finalStateHash);
});

test("seeks reconstruct identical worlds and input-tick diagnostics with bounded checkpoints", async () => {
  const { game, replay } = await fixture();
  const session = await createReplaySession(replay, game);
  expect(session.errorTicks).toEqual([0, 3]);
  expect(session.frame(0).record).toBeNull();
  const first = session.frame(1);
  expect(first.previousState.tick).toBe(0);
  expect(first.state.tick).toBe(1);
  expect(first.record?.tick).toBe(0);
  expect(first.record?.errors?.a?.message).toBe("example failure");
  expect(session.observation(1, "a")).toMatchObject({ tick: 0, counter: 0, selfId: "a" });
  for (const tick of [49, 1200, 51, 749, 50, 0, 1199, 1, 1200]) {
    const frame = session.frame(tick);
    expect(frame.state.counter).toBe(tick * 2 - (tick > 0 ? 1 : 0) - (tick > 3 ? 1 : 0));
    expect(frame.previousState.tick).toBe(Math.max(0, tick - 1));
    expect(session.cacheInfo.count).toBeLessThanOrEqual(16);
    expect(session.cacheInfo.bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  }
  expect(await stateHash(session.frame(1200).state)).toBe(replay.finalStateHash);
  expect(session.frame(50).events).toEqual([{ tick: 49 }]);
});

test("source data and returned worlds cannot alter future seeks", async () => {
  const { game, replay } = await fixture(100);
  const session = await createReplaySession(replay, game);
  replay.ticks[0]!.actions.a = { add: 1 };
  expect(() => {
    (session.frame(1).state as { counter: number }).counter = 999;
  }).toThrow();
  expect(() => {
    (session.frame(1).record!.actions as Record<string, unknown>).a = { add: 1 };
  }).toThrow();
  expect(session.frame(100).state.counter).toBe(198);
  expect(session.frame(1).state.counter).toBe(1);
  for (const tick of [-1, 101, 0.5, NaN]) expect(() => session.frame(tick)).toThrow();
});

test("corrupt results, hashes and releases never produce a playable session", async () => {
  const { game, replay } = await fixture(4);
  for (const corrupt of [
    { ...replay, finalStateHash: "0".repeat(64) },
    { ...replay, game: { ...replay.game, release: "counter@2" } },
    { ...replay, ticks: replay.ticks.slice(1) },
    { ...replay, result: { ...replay.result, completedTicks: 999 } },
  ])
    await expect(createReplaySession(corrupt, game)).rejects.toThrow();
});

test("cancelled validation rejects before exposing checkpoints or diagnostics", async () => {
  const { game, replay } = await fixture(100);
  const controller = new AbortController();
  let yielded = 0;
  await expect(
    createReplaySession(replay, game, {
      signal: controller.signal,
      async yieldControl() {
        yielded++;
        controller.abort();
      },
    }),
  ).rejects.toThrow(/取消/);
  expect(yielded).toBe(1);
  await expect(createReplaySession(replay, game, { signal: controller.signal })).rejects.toThrow(
    /取消/,
  );
});

test("small cache budgets evict checkpoints and retain the initial world", async () => {
  const { game, replay } = await fixture(500);
  const session = await createReplaySession(replay, game, { cacheBytes: 300 });
  expect(session.cacheInfo.bytes).toBeLessThanOrEqual(300);
  expect(session.frame(500).state.counter).toBe(998);
  expect(session.frame(0).state.counter).toBe(0);
  await expect(createReplaySession(replay, game, { cacheBytes: 1 })).rejects.toThrow(
    /cache budget/,
  );
});
