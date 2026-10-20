import { expect, test } from "vitest";
import { cloneJson, resolveResourceLimits } from "@si-arena/protocol";
import {
  EngineError,
  MemoryReplaySink,
  replayMatch,
  runMatch,
  type ExecutorOutcome,
  type ReplaySink,
} from "../src";
import { fixture, outcome, players, toyGame, type ToyAction, type ToyState } from "./helpers";

test("one step per tick, common observations, immutable inputs and no per-tick snapshots in replay", async () => {
  const f = fixture();
  const original = cloneJson(f.options.players);
  const result = await runMatch(f.options);
  expect(result.result.completedTicks).toBe(3);
  expect(result.finalState.total).toBe(6);
  expect(f.calls.map((call) => [call.observation.tick, call.observation.total])).toEqual([
    [0, 0],
    [0, 0],
    [1, 2],
    [1, 2],
    [2, 4],
    [2, 4],
  ]);
  expect(f.closed.toSorted()).toEqual(["a", "b"]);
  expect(f.options.players).toEqual(original);
  expect(f.sink.replay.ticks).toHaveLength(3);
  expect(Object.keys(f.sink.replay.ticks[0]!)).toEqual(["tick", "actions"]);
  expect(f.sink.replay.initialState.tick).toBe(0);
  expect(Object.isFrozen(result.finalState)).toBe(true);
  const repeated = await replayMatch(f.sink.replay, toyGame);
  expect(repeated).toEqual(result);
});

test("out-of-order execution and mutations of observations never change the shared world", async () => {
  const completions: string[] = [];
  const f = fixture({
    async createExecutor(player) {
      return {
        async execute(tick, observation) {
          expect(observation.total).toBe(tick * 2);
          observation.total = 999;
          // The gap must force 'b' to complete first even when slow shared CI
          // runners add scheduling jitter between dispatching the two executions.
          await new Promise((resolve) => setTimeout(resolve, player.id === "a" ? 50 : 0));
          completions.push(player.id);
          return outcome(player.id, tick);
        },
        async close() {},
      };
    },
  });
  expect((await runMatch(f.options)).finalState.total).toBe(6);
  expect(completions).toEqual(["b", "a", "b", "a", "b", "a"]);
});

test("failed players use the game fallback and errors survive in server replay without logs", async () => {
  const f = fixture({
    async createExecutor(player) {
      return {
        async execute(tick) {
          return player.id === "a" && tick === 1
            ? {
                ...outcome(player.id, tick),
                ok: false,
                action: { add: 2 },
                error: { type: "RUNTIME_ERROR", message: "boom" },
                logs: [{ level: "log", message: "private" }],
                logsTruncated: true,
              }
            : outcome(player.id, tick);
        },
        async close() {},
      };
    },
  });
  const result = await runMatch(f.options);
  expect(result.finalState.total).toBe(5);
  expect(f.sink.replay.ticks[1]).toEqual({
    tick: 1,
    actions: { a: { add: 0 }, b: { add: 1 } },
    errors: { a: { type: "RUNTIME_ERROR", message: "boom" } },
  });
  expect((await replayMatch(f.sink.replay, toyGame)).finalStateHash).toBe(result.finalStateHash);
});

test("local logs are independently bounded by line, tick, and shared match budgets", async () => {
  const game = {
    ...toyGame,
    manifest: {
      ...toyGame.manifest,
      resolvedLimits: resolveResourceLimits({
        logs: { lineBytes: 8, tickLines: 2, tickBytes: 12, matchBytes: 20 },
      }),
    },
  };
  const f = fixture({
    game,
    captureLogs: true,
    async createExecutor(player) {
      return {
        async execute(tick) {
          return {
            ...outcome(player.id, tick),
            logs: Array.from({ length: 5 }, () => ({
              level: "info" as const,
              message: "界".repeat(10),
            })),
          };
        },
        async close() {},
      };
    },
  });
  await runMatch(f.options);
  const logs = f.sink.replay.ticks.flatMap((tick) => Object.values(tick.logs ?? {}).flat());
  expect(logs.reduce((n, log) => n + Buffer.byteLength(log.message), 0)).toBeLessThanOrEqual(20);
  expect(f.sink.replay.ticks.some((tick) => tick.logsTruncated)).toBe(true);
  await expect(replayMatch(f.sink.replay, game)).resolves.toBeDefined();
});

test("inactive players are omitted from execution and actions", async () => {
  const game = {
    ...toyGame,
    rules: {
      ...toyGame.rules,
      observe(state: Readonly<ToyState>, id: string) {
        return id === "a" && state.tick > 0
          ? null
          : { tick: state.tick, total: state.total, selfId: id };
      },
    },
  };
  const f = fixture({ game });
  await runMatch(f.options);
  expect(f.calls.filter((call) => call.id === "a")).toHaveLength(1);
  expect(f.sink.replay.ticks[1]?.actions).toEqual({ b: { add: 1 } });
  await replayMatch(f.sink.replay, game);
});

test.each(["tick", "playerId", "matchId", "executionId"])(
  "mismatched %s results fail the match without publishing replay",
  async (key) => {
    const f = fixture({
      async createExecutor(player) {
        return {
          async execute(tick) {
            return {
              ...outcome(player.id, tick),
              [key]: key === "tick" ? tick + 1 : key === "executionId" ? "" : "wrong",
            } as ExecutorOutcome<ToyAction>;
          },
          async close() {},
        };
      },
    });
    await expect(runMatch(f.options)).rejects.toBeInstanceOf(EngineError);
    expect(() => f.sink.replay).toThrow("not completed");
  },
);

test.each(["rules", "tick", "result", "missing-terminal", "default", "observation"])(
  "trusted %s errors abort rather than create player diagnostics",
  async (cause) => {
    const game = { ...toyGame, rules: { ...toyGame.rules } };
    if (cause === "rules")
      game.rules.step = () => {
        throw new Error("Broken rules");
      };
    if (cause === "tick")
      game.rules.step = (state) => ({
        nextState: {
          ...cloneJson(state),
          tick: state.tick + 2,
          players: state.players.map((p) => ({ ...p })),
        },
        events: [],
      });
    if (cause === "result")
      game.rules.step = (state) => ({
        nextState: {
          ...cloneJson(state),
          tick: state.tick + 1,
          players: state.players.map((p) => ({ ...p })),
        },
        events: [],
        result: { reason: "bad", completedTicks: 99, players: [] },
      });
    if (cause === "missing-terminal") {
      const step = toyGame.rules.step;
      game.rules.step = (state, actions) => {
        const { nextState, events } = step(state, actions);
        return { nextState, events };
      };
    }
    if (cause === "default") game.rules.defaultAction = () => ({ add: 99 });
    if (cause === "observation") game.rules.observe = () => ({ tick: 0, total: NaN, selfId: "a" });
    const f = fixture({ game });
    await expect(runMatch(f.options)).rejects.toBeInstanceOf(EngineError);
    expect(f.closed.toSorted()).toEqual(["a", "b"]);
    expect(() => f.sink.replay).toThrow();
  },
);

test("startup failures close players that finish initialization later", async () => {
  const closed: string[] = [];
  const f = fixture({
    async createExecutor(player) {
      if (player.id === "a") throw new Error("No capacity");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        async execute(tick) {
          return outcome(player.id, tick);
        },
        async close() {
          closed.push(player.id);
        },
      };
    },
  });
  await expect(runMatch(f.options)).rejects.toThrow("No capacity");
  expect(closed).toEqual(["b"]);
});

test("sink failures close every executor and never complete the replay", async () => {
  let aborted = false,
    finished = false;
  const sink: ReplaySink<ToyState, ToyAction> = {
    async start() {},
    async append() {
      throw new Error("disk full");
    },
    async finish() {
      finished = true;
    },
    async abort() {
      aborted = true;
    },
  };
  const f = fixture({ sink });
  await expect(runMatch(f.options)).rejects.toThrow("disk full");
  expect(aborted).toBe(true);
  expect(finished).toBe(false);
  expect(f.closed.toSorted()).toEqual(["a", "b"]);
});

test("cancellation during execution closes all players and aborts the sink", async () => {
  const controller = new AbortController();
  let executing = 0;
  const closed: string[] = [];
  const f = fixture({
    signal: controller.signal,
    async createExecutor(player) {
      let resolve: ((value: ExecutorOutcome<ToyAction>) => void) | undefined;
      return {
        execute(_tick) {
          executing++;
          if (executing === 2) queueMicrotask(() => controller.abort());
          return new Promise((done) => {
            resolve = done;
          });
        },
        async close() {
          closed.push(player.id);
          resolve?.({
            ...outcome(player.id, 0),
            ok: false,
            error: { type: "EXECUTOR_ERROR", message: "closed" },
          });
        },
      };
    },
  });
  await expect(runMatch(f.options)).rejects.toThrow("cancelled");
  expect(closed.toSorted()).toEqual(["a", "b"]);
});

test("small memory sinks reject overflow and cannot expose partial matches", async () => {
  const f = fixture({ sink: new MemoryReplaySink<ToyState, ToyAction>(64) });
  await expect(runMatch(f.options)).rejects.toThrow("byte limit");
});

test("malformed platform observations never run bot code or become player errors", async () => {
  const game = {
    ...toyGame,
    rules: {
      ...toyGame.rules,
      observe() {
        return { tick: 0, total: 0, selfId: "wrong-player" };
      },
    },
  };
  const f = fixture({ game });
  await expect(runMatch(f.options)).rejects.toThrow("Invalid toy observation");
  expect(f.calls).toHaveLength(0);
  expect(f.closed.toSorted()).toEqual(["a", "b"]);
});

test("published release data and rule functions are fixed before the first tick", async () => {
  const game = { ...toyGame, manifest: cloneJson(toyGame.manifest), rules: { ...toyGame.rules } };
  const f = fixture({
    game,
    onTick() {
      game.manifest.maxTicks = 1;
      game.manifest.resolvedLimits.cpuMs = 999;
      game.rules.step = () => {
        throw new Error("replaced");
      };
    },
  });
  expect((await runMatch(f.options)).result.completedTicks).toBe(3);
  expect(f.sink.replay.resolvedLimits.cpuMs).toBe(20);
});

test("prototype-like participant IDs remain ordinary action keys", async () => {
  const ids = ["__proto__", "constructor"];
  const f = fixture({
    players: players.map((p, i) => ({ ...p, id: ids[i]! })),
    async createExecutor(player) {
      return {
        async execute(tick) {
          return outcome(player.id, tick);
        },
        async close() {},
      };
    },
  });
  const result = await runMatch(f.options);
  expect(result.finalState.total).toBe(6);
  expect(Object.hasOwn(f.sink.replay.ticks[0]!.actions, "__proto__")).toBe(true);
  await replayMatch(f.sink.replay, toyGame);
});
