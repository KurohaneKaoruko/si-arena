import type { PaperState, PaperPlayer, PaperDirection } from "@si-arena/game-paper/sdk";
import type { PaperEvent, PaperResult } from "@si-arena/game-paper/rules";
import type { Position, TickActions } from "./helpers";
import { createHash } from "node:crypto";
import { test, expect } from "vitest";
import { paperRules, parsePaperState } from "@si-arena/game-paper/rules";
import { actions, box, idle, init, move, play, stepFrozen, world } from "./helpers";
import { required, resultOf } from "./helpers";

const hash = (state: PaperState) =>
  createHash("sha256").update(JSON.stringify(state)).digest("hex");

const reflectPlayer = (player: PaperPlayer): PaperPlayer => ({
  ...player,
  position: player.position ? { x: 39 - player.position.x, y: player.position.y } : null,
});
const reflect = (state: PaperState): PaperState => ({
  ...structuredClone(state),
  territory: state.territory.map((_, index) =>
    required(state.territory[Math.floor(index / 40) * 40 + 39 - (index % 40)]),
  ),
  trails: state.trails.map((_, index) =>
    required(state.trails[Math.floor(index / 40) * 40 + 39 - (index % 40)]),
  ),
  players: [reflectPlayer(state.players[0]), reflectPlayer(state.players[1])],
});
const point = ({ x, y }: Position) => ({ x: 39 - x, y });
const reflectEvent = (event: PaperEvent): PaperEvent => {
  if (event.type === "move") return { ...event, from: point(event.from), to: point(event.to) };
  if (event.type === "trail-cut") return { ...event, position: point(event.position) };
  if (event.type === "capture")
    return {
      ...event,
      cells: event.cells
        .map((index) => Math.floor(index / 40) * 40 + 39 - (index % 40))
        .toSorted((a, b) => a - b),
    };
  return event;
};

test("the 600th completed tick ends a tied game and cannot be followed by another action", () => {
  const ticks = Array.from({ length: 600 }, () => actions());
  const output = play(init(), ticks);
  expect(resultOf(output).reason).toBe("tick-limit");
  expect(resultOf(output).completedTicks).toBe(600);
  expect(
    resultOf(output).players.map((player) => [player.rank, player.score, player.alive]),
  ).toStrictEqual([
    [1, 9, true],
    [1, 9, true],
  ]);
  expect(paperRules.observe(output.state, "alpha")).toBe(null);
  expect(() => paperRules.step(output.state, actions())).toThrow(/finished/);
});

test("the tick limit compares territory but elimination on the last tick takes priority", () => {
  const state = world();
  state.tick = 599;
  state.territory[0] = 0;
  const timed = stepFrozen(state, actions());
  expect(resultOf(timed).reason).toBe("tick-limit");
  expect(resultOf(timed).players.map((player) => [player.rank, player.score])).toStrictEqual([
    [1, 2],
    [2, 1],
  ]);
  const edge = world([
    { x: 0, y: 0 },
    { x: 39, y: 29 },
  ]);
  edge.tick = 599;
  const eliminated = stepFrozen(edge, actions(move("left")));
  expect(resultOf(eliminated).reason).toBe("last-survivor");
  const mutual = stepFrozen(edge, actions(move("left"), move("right")));
  expect(resultOf(mutual).reason).toBe("mutual-elimination");
});

test("a full match is reproduced solely from serialized initial state and action records", () => {
  const directions = [
    ...Array<PaperDirection>(4).fill("right"),
    ...Array<PaperDirection>(4).fill("down"),
    ...Array<PaperDirection>(4).fill("left"),
    ...Array<PaperDirection>(4).fill("up"),
  ];
  const opposite = { right: "left", down: "up", left: "right", up: "down" } as const;
  const records = Array.from({ length: 600 }, (_, tick) => {
    const direction = directions[tick];
    return actions(
      direction ? move(direction) : idle(),
      direction ? move(opposite[direction]) : idle(),
    );
  });
  const initial = init(2);
  const live = play(initial, records);
  const replay = play(JSON.parse(JSON.stringify(initial)), JSON.parse(JSON.stringify(records)));
  expect(live).toStrictEqual(replay);
  expect(resultOf(live).players.map((player) => [player.rank, player.score])).toStrictEqual([
    [1, 30],
    [1, 30],
  ]);
  expect(live.events.flat().filter((event) => event.type === "capture").length).toBe(2);
  expect(live.state.rngState, "step does not consume additional random numbers").toBe(
    initial.rngState,
  );
  expect(hash(live.state)).toBe(hash(replay.state));
  expect(parsePaperState(replay.state)).toStrictEqual(replay.state);
});

test("rules do not use host randomness or wall time", () => {
  const originalRandom = Math.random;
  const originalNow = Date.now;
  try {
    Math.random = () => {
      throw new Error("Host randomness is forbidden");
    };
    Date.now = () => {
      throw new Error("Wall time is forbidden");
    };
    const output = stepFrozen(init(0), actions());
    expect(output.nextState.tick).toBe(1);
  } finally {
    Math.random = originalRandom;
    Date.now = originalNow;
  }
});

test("deterministic generated games keep every state valid and ignore action insertion order", () => {
  for (let seed = 1; seed <= 32; seed++) {
    let state = init(seed);
    let result: PaperResult | undefined;
    let random = seed;
    for (let tick = 0; tick < 600 && !result; tick++) {
      const directions = ["up", "right", "down", "left"] as const;
      const pick = () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random % 5 === 4 ? idle() : move(required(directions[(random >>> 8) % 4]));
      };
      const input = actions(pick(), pick());
      const ordered = stepFrozen(state, input);
      const reversed = stepFrozen(state, Object.fromEntries(Object.entries(input).toReversed()));
      expect(ordered, `seed ${seed}, tick ${tick}`).toStrictEqual(reversed);
      state = ordered.nextState;
      result = ordered.result;
      expect(parsePaperState(state)).toStrictEqual(state);
    }
    expect(result, `seed ${seed} terminates within the published budget`).toBeTruthy();
    expect(required(result).completedTicks).toBe(state.tick);
  }
});

test("horizontal reflection preserves outcomes and reflects the same rule events", () => {
  const nested = box(world(), 0, 2, 2, 8, 8);
  box(nested, 1, 4, 4, 6, 6);
  const cases: Array<[PaperState, TickActions]> = [
    [init(), actions(move("up"), move("left"))],
    [
      world([
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ]),
      actions(move("right"), move("left")),
    ],
    [nested, actions(move("left"), move("left"))],
  ];
  for (const [state, input] of cases) {
    const mirroredActions = Object.fromEntries(
      Object.entries(input).map(([id, action]) => [
        id,
        action.type === "idle"
          ? idle()
          : move(
              action.direction === "left"
                ? "right"
                : action.direction === "right"
                  ? "left"
                  : action.direction,
            ),
      ]),
    );
    const original = stepFrozen(state, input);
    const mirrored = stepFrozen(reflect(state), mirroredActions);
    expect(mirrored.nextState).toStrictEqual(reflect(original.nextState));
    expect(mirrored.result).toStrictEqual(original.result);
    expect(mirrored.events).toStrictEqual(original.events.map(reflectEvent));
  }
});
