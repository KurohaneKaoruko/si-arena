import { expect, test } from "vitest";
import { snakeMapSize } from "@si-arena/game-snake";
import type { SnakeDirection } from "@si-arena/game-snake/sdk";
import { snakeRules } from "@si-arena/game-snake/rules";
import type { Cell } from "./helpers";
import {
  bodyOf,
  deaths,
  eliminate,
  eventsOf,
  foodOf,
  init,
  move,
  ranks,
  required,
  resultOf,
  step,
  world,
} from "./helpers";

test("the map side follows the player count and every snake starts stacked in a corner", () => {
  expect([2, 3, 4].map(snakeMapSize)).toStrictEqual([15, 17, 19]);
  for (const players of [2, 3, 4]) {
    const state = init(players);
    const side = snakeMapSize(players);
    const far = side - 3;
    expect([state.width, state.height, state.tick, state.maxTicks]).toStrictEqual([
      side,
      side,
      0,
      500,
    ]);
    const corners = [
      [2, 2],
      [far, 2],
      [2, far],
      [far, far],
    ];
    const spawns = new Set<string>();
    for (const snake of state.snakes) {
      const [head] = snake.body;
      expect(snake.body).toStrictEqual([head, head, head]);
      expect(corners).toContainEqual([head!.x, head!.y]);
      spawns.add(`${head!.x},${head!.y}`);
      expect(snake.heading).toBe(head!.x === 2 ? "right" : "left");
      expect([snake.health, snake.death]).toStrictEqual([100, null]);
    }
    expect(spawns.size).toBe(players);
    const centre = (side - 1) / 2;
    const expectedFood = [
      [centre, centre],
      ...state.snakes.map(({ body: [head] }) => [
        head!.x + 2 * Math.sign(centre - head!.x),
        head!.y + 2 * Math.sign(centre - head!.y),
      ]),
    ].toSorted((a, b) => a[1]! * side + a[0]! - (b[1]! * side + b[0]!));
    expect(foodOf(state)).toStrictEqual(expectedFood);
  }
});

test("the seed shuffles the corners among seats and seed 0 is the fixed constant", () => {
  const orders = new Set<string>();
  for (let seed = 0; seed < 50; seed++)
    orders.add(
      init(4, seed)
        .snakes.map((snake) => `${snake.body[0]!.x},${snake.body[0]!.y}`)
        .join(),
    );
  expect(orders.size).toBeGreaterThan(4);
  expect(init(4, 0)).toStrictEqual(init(4, 0x9e3779b9));
  expect(init(4, 1)).not.toStrictEqual(init(4, 2));
  // Two players take the first two shuffled corners, so both halves of the map can start a seat.
  const twoPlayerHeadings = new Set(
    Array.from({ length: 50 }, (_, seed) => init(2, seed).snakes[0]!.heading),
  );
  expect(twoPlayerHeadings).toStrictEqual(new Set(["right", "left"]));
});

test("a plain move costs health, keeps the length and unfolds the stacked spawn without self-harm", () => {
  const state = init(2);
  const output = step(state);
  const alpha = output.nextState.snakes[0]!;
  expect(alpha.health).toBe(99);
  expect(bodyOf(output.nextState, 0)).toStrictEqual([
    [3, 2],
    [2, 2],
    [2, 2],
  ]);
  expect(alpha.heading).toBe("right");
  expect(deaths(output)).toStrictEqual([]);
  expect(eventsOf(output, "move")).toStrictEqual([
    { type: "move", playerId: "alpha", from: { x: 2, y: 2 }, to: { x: 3, y: 2 } },
    { type: "move", playerId: "beta", from: { x: 12, y: 12 }, to: { x: 11, y: 12 } },
  ]);
  expect(output.nextState.tick).toBe(1);
  expect(output.nextState.rngState).toBe(state.rngState);
  expect(output.result).toBe(undefined);
  const turned = step(output.nextState, { 0: move("down") });
  expect(bodyOf(turned.nextState, 0)).toStrictEqual([
    [3, 3],
    [3, 2],
    [2, 2],
  ]);
  expect(turned.nextState.snakes[0]!.heading).toBe("down");
});

test("eating restores health, grows by keeping the tail and removes the food", () => {
  const state = world(
    [
      [
        [5, 5],
        [4, 5],
        [3, 5],
      ],
      [
        [10, 10],
        [10, 9],
        [10, 8],
      ],
    ],
    [
      [6, 5],
      [0, 0],
    ],
    40,
  );
  const output = step(state);
  expect(output.nextState.snakes[0]!.health).toBe(100);
  expect(bodyOf(output.nextState, 0)).toStrictEqual([
    [6, 5],
    [5, 5],
    [4, 5],
    [3, 5],
  ]);
  expect(output.nextState.snakes[1]!.health).toBe(39);
  expect(eventsOf(output, "eat")).toStrictEqual([
    { type: "eat", playerId: "alpha", position: { x: 6, y: 5 } },
  ]);
  expect(foodOf(output.nextState)).toContainEqual([0, 0]);
  expect(foodOf(output.nextState)).not.toContainEqual([6, 5]);
  const types = output.events.map((event) => event.type);
  expect(types.slice(0, 3)).toStrictEqual(["move", "move", "eat"]);
  expect(types.slice(3).every((type) => type === "food-spawn")).toBe(true);
  expect(types.length).toBeGreaterThan(3);
});

test("moving off the map kills the snake and reports the target beyond the edge", () => {
  const state = world([
    [
      [0, 5],
      [1, 5],
      [2, 5],
    ],
    [
      [10, 10],
      [10, 9],
      [10, 8],
    ],
  ]);
  const output = step(state);
  expect(deaths(output)).toStrictEqual([["alpha", ["boundary"]]]);
  expect(eventsOf(output, "move")[0]).toStrictEqual({
    type: "move",
    playerId: "alpha",
    from: { x: 0, y: 5 },
    to: { x: -1, y: 5 },
  });
  expect(eventsOf(output, "death")[0]?.position).toStrictEqual({ x: -1, y: 5 });
  const alpha = output.nextState.snakes[0]!;
  expect([alpha.body, alpha.health, alpha.death]).toStrictEqual([
    [],
    0,
    { tick: 1, causes: ["boundary"] },
  ]);
  expect(resultOf(output).reason).toBe("elimination");
  expect(snakeRules.observe(output.nextState, "alpha")).toBe(null);
});

test("health reaching zero starves unless the snake eats on that very tick", () => {
  const bodies: Cell[][] = [
    [
      [5, 5],
      [4, 5],
      [3, 5],
    ],
    [
      [10, 10],
      [10, 9],
      [10, 8],
    ],
    [
      [2, 12],
      [2, 13],
      [2, 14],
    ],
  ];
  const starving = step(world(bodies, [[6, 5]], 1), { 0: move("down") });
  expect(deaths(starving)).toStrictEqual([
    ["alpha", ["starvation"]],
    ["beta", ["starvation"]],
    ["gamma", ["starvation"]],
  ]);
  expect(eventsOf(starving, "death")[0]?.position).toStrictEqual({ x: 5, y: 6 });
  const fed = step(world(bodies, [[6, 5]], 1));
  expect(deaths(fed)).toStrictEqual([
    ["beta", ["starvation"]],
    ["gamma", ["starvation"]],
  ]);
  expect(fed.nextState.snakes[0]!.health).toBe(100);
  expect(snakeRules.observe(world(bodies, [], 1), "alpha")?.snakes[0]?.health).toBe(1);
});

test("entering any body segment kills, including reversing into the own neck", () => {
  const bodies: Cell[][] = [
    [
      [5, 5],
      [4, 5],
      [3, 5],
    ],
    [
      [5, 7],
      [5, 6],
      [6, 6],
      [7, 6],
    ],
  ];
  const intoOther = step(world(bodies), { 0: move("down") });
  expect(deaths(intoOther)).toStrictEqual([["alpha", ["body-collision"]]]);
  expect(eventsOf(intoOther, "death")[0]?.position).toStrictEqual({ x: 5, y: 6 });
  const reversed = step(world(bodies), { 0: move("left") });
  expect(deaths(reversed)).toStrictEqual([["alpha", ["body-collision"]]]);
  expect(bodyOf(reversed.nextState, 1)).toStrictEqual([
    [5, 8],
    [5, 7],
    [5, 6],
    [6, 6],
  ]);
});

test("a tail that moves away frees its cell, a tail kept by eating does not", () => {
  const chase: Cell[][] = [
    [
      [5, 5],
      [4, 5],
      [3, 5],
    ],
    [
      [6, 7],
      [6, 6],
      [6, 5],
    ],
  ];
  const freed = step(world(chase), { 0: move("right") });
  expect(deaths(freed)).toStrictEqual([]);
  expect(bodyOf(freed.nextState, 0)).toStrictEqual([
    [6, 5],
    [5, 5],
    [4, 5],
  ]);
  // Beta eats and keeps its tail, so the cell alpha enters is still occupied.
  const kept = step(world(chase, [[6, 8]]), { 0: move("right") });
  expect(deaths(kept)).toStrictEqual([["alpha", ["body-collision"]]]);
  const ownTail = step(
    world([
      [
        [5, 5],
        [4, 5],
        [4, 6],
        [5, 6],
      ],
      [
        [10, 10],
        [10, 9],
        [10, 8],
      ],
    ]),
    { 0: move("down") },
  );
  expect(deaths(ownTail)).toStrictEqual([]);
  expect(bodyOf(ownTail.nextState, 0)).toStrictEqual([
    [5, 6],
    [5, 5],
    [4, 5],
    [4, 6],
  ]);
});

test("a stacked spawn tail stays occupied and another snake entering it dies", () => {
  const state = init(2);
  // Alpha starts stacked at (2,2); beta is placed next to it with a tail that moves away.
  state.snakes[1]!.body = [
    { x: 2, y: 3 },
    { x: 2, y: 4 },
    { x: 2, y: 5 },
  ];
  state.snakes[1]!.heading = "up";
  const output = step(state, { 0: move("right"), 1: move("up") });
  expect(deaths(output)).toStrictEqual([["beta", ["body-collision"]]]);
});

test("head-on meetings kill the shorter snake, or both when equal", () => {
  const equal = step(
    world([
      [
        [5, 5],
        [4, 5],
        [3, 5],
      ],
      [
        [7, 5],
        [8, 5],
        [9, 5],
      ],
    ]),
  );
  expect(deaths(equal)).toStrictEqual([
    ["alpha", ["head-collision"]],
    ["beta", ["head-collision"]],
  ]);
  expect(ranks(equal)).toStrictEqual([
    [1, 0, false],
    [1, 0, false],
  ]);
  const longer = step(
    world([
      [
        [5, 5],
        [4, 5],
        [3, 5],
        [2, 5],
      ],
      [
        [7, 5],
        [8, 5],
        [9, 5],
      ],
    ]),
  );
  expect(deaths(longer)).toStrictEqual([["beta", ["head-collision"]]]);
  expect(bodyOf(longer.nextState, 0)).toStrictEqual([
    [6, 5],
    [5, 5],
    [4, 5],
    [3, 5],
  ]);
  // Growth on this tick counts: eating the contested food makes alpha the longer one.
  const grown = step(
    world(
      [
        [
          [5, 5],
          [4, 5],
          [3, 5],
        ],
        [
          [7, 5],
          [8, 5],
          [9, 5],
        ],
      ],
      [[6, 5]],
    ),
  );
  expect(eventsOf(grown, "eat").map((event) => event.playerId)).toStrictEqual(["alpha", "beta"]);
  expect(deaths(grown)).toStrictEqual([
    ["alpha", ["head-collision"]],
    ["beta", ["head-collision"]],
  ]);
  expect(foodOf(grown.nextState)).not.toContainEqual([6, 5]);
});

test("several causes are listed in the fixed order and the dead vanish together", () => {
  const output = step(
    world(
      [
        [
          [0, 5],
          [1, 5],
          [2, 5],
        ],
        [
          [5, 6],
          [5, 7],
          [5, 8],
        ],
        [
          [5, 4],
          [5, 3],
          [5, 2],
        ],
      ],
      [],
      1,
    ),
    { 0: move("left"), 1: move("up"), 2: move("down") },
  );
  expect(deaths(output)).toStrictEqual([
    ["alpha", ["boundary", "starvation"]],
    ["beta", ["starvation", "head-collision"]],
    ["gamma", ["starvation", "head-collision"]],
  ]);
  for (const snake of output.nextState.snakes) expect(snake.body).toStrictEqual([]);
  expect(resultOf(output)).toMatchObject({ reason: "elimination", completedTicks: 1 });
  expect(ranks(output)).toStrictEqual([
    [1, 0, false],
    [1, 0, false],
    [1, 0, false],
  ]);
  const bodyAndHead = step(
    world([
      [
        [5, 5],
        [4, 5],
        [3, 5],
      ],
      [
        [6, 4],
        [6, 5],
        [6, 6],
      ],
      [
        [7, 5],
        [8, 5],
        [9, 5],
      ],
    ]),
  );
  expect(deaths(bodyAndHead)).toStrictEqual([
    ["alpha", ["body-collision", "head-collision"]],
    ["gamma", ["body-collision", "head-collision"]],
  ]);
  expect(bodyOf(bodyAndHead.nextState, 1)).toStrictEqual([
    [6, 3],
    [6, 4],
    [6, 5],
  ]);
});

const bodies: Cell[][] = [
  [
    [5, 5],
    [4, 5],
    [3, 5],
  ],
  [
    [10, 10],
    [10, 9],
    [10, 8],
  ],
];

test("food is topped up to the number of living snakes with a seeded bonus piece", () => {
  const full = step(
    world(bodies, [
      [0, 0],
      [1, 0],
    ]),
  );
  expect(eventsOf(full, "food-spawn")).toStrictEqual([]);
  expect(full.nextState.rngState).toBe(world(bodies).rngState);
  const short = world(bodies, [[0, 0]]);
  const output = step(short);
  const spawned = eventsOf(output, "food-spawn");
  expect(spawned.length).toBeGreaterThanOrEqual(1);
  expect(output.nextState.rngState).not.toBe(short.rngState);
  const food = foodOf(output.nextState);
  expect(food).toHaveLength(1 + spawned.length);
  expect(food).toStrictEqual(
    food.toSorted((a, b) => a[1] * short.width + a[0] - (b[1] * short.width + b[0])),
  );
  const occupied = new Set(
    output.nextState.snakes.flatMap((snake) => snake.body.map((c) => `${c.x},${c.y}`)),
  );
  for (const [x, y] of food) expect(occupied.has(`${x},${y}`)).toBe(false);
  // The second draw is a 15% chance: both outcomes occur across seeds, and the pick is
  // the empty cell with index next() % count.
  const counts = new Set<number>();
  for (let seed = 1; seed <= 60 && counts.size < 2; seed++) {
    const state = world(bodies, [[0, 0]]);
    state.rngState = seed;
    counts.add(eventsOf(step(state), "food-spawn").length);
  }
  expect(counts).toStrictEqual(new Set([1, 2]));
  const chosen = world(bodies, [[0, 0]]);
  chosen.rngState = 7;
  let rng = 7;
  const next = () => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    rng >>>= 0;
    return rng;
  };
  const after = step(chosen).nextState;
  const taken = new Set([
    ...after.snakes.flatMap((snake) => snake.body.map((c) => c.y * 15 + c.x)),
    0,
  ]);
  const empty = Array.from({ length: 225 }, (_, cell) => cell).filter((cell) => !taken.has(cell));
  const first = required(empty[next() % empty.length]);
  expect(eventsOf(step(chosen), "food-spawn")[0]?.position).toStrictEqual({
    x: first % 15,
    y: Math.floor(first / 15),
  });
});

test("food still spawns on the tick the game ends", () => {
  const output = step(world(bodies, [], 1));
  expect(deaths(output)).toHaveLength(2);
  expect(eventsOf(output, "food-spawn").length).toBeGreaterThanOrEqual(1);
  expect(output.result).toBeDefined();
});

const towardsTail = (body: Cell[]): SnakeDirection => {
  const [head, tail] = [required(body[0]), required(body.at(-1))];
  if (tail[0] > head[0]) return "right";
  if (tail[0] < head[0]) return "left";
  return tail[1] > head[1] ? "down" : "up";
};

/** Hamiltonian cycles over two halves of the 15×15 board, leaving (14,14) free. */
function fullBoard(): { left: Cell[]; right: Cell[] } {
  const left: Cell[] = [];
  for (let x = 0; x <= 7; x++) left.push([x, 0]);
  for (let x = 7; x >= 0; x--)
    for (let row = 1; row <= 14; row++) left.push([x, (7 - x) % 2 === 0 ? row : 15 - row]);
  const right: Cell[] = [];
  for (let y = 0; y <= 14; y++) right.push([8, y]);
  for (let x = 9; x <= 13; x++) right.push([x, 14]);
  for (let y = 13; y >= 0; y--)
    right.push(
      ...(((13 - y) % 2 === 0
        ? [
            [13, y],
            [14, y],
          ]
        : [
            [14, y],
            [13, y],
          ]) as Cell[]),
    );
  for (let x = 12; x >= 9; x--)
    for (let row = 0; row <= 13; row++) right.push([x, (12 - x) % 2 === 0 ? row : 13 - row]);
  return { left, right };
}

test("with no empty cell nothing spawns and no random number is drawn", () => {
  const { left, right } = fullBoard();
  expect(left).toHaveLength(120);
  expect(right).toHaveLength(104);
  const state = world([left, right], [[14, 14]]);
  const output = step(state, { 0: move(towardsTail(left)), 1: move(towardsTail(right)) });
  expect(deaths(output)).toStrictEqual([]);
  expect(eventsOf(output, "food-spawn")).toStrictEqual([]);
  expect(output.nextState.rngState).toBe(state.rngState);
  expect(foodOf(output.nextState)).toStrictEqual([[14, 14]]);
});

test("observations list the living by slot with head and length, the dead with their causes", () => {
  const state = eliminate(init(3), 2, 1);
  const observation = required(snakeRules.observe(state, "beta"));
  expect(observation).toMatchObject({
    tick: 1,
    maxTicks: 500,
    selfId: "beta",
    selfSlot: 1,
    board: { width: 17, height: 17 },
    eliminated: [{ id: "gamma", slot: 2, tick: 1, causes: ["boundary"] }],
    events: [],
  });
  expect(
    observation.snakes.map((s) => [s.id, s.slot, s.length, s.health, s.heading]),
  ).toStrictEqual([
    ["alpha", 0, 3, 100, state.snakes[0]!.heading],
    ["beta", 1, 3, 100, state.snakes[1]!.heading],
  ]);
  expect(observation.snakes[0]!.head).toStrictEqual(state.snakes[0]!.body[0]);
  expect(observation.food).toStrictEqual(state.food);
  expect(snakeRules.observe(state, "gamma")).toBe(null);
  expect(snakeRules.defaultAction(state, "alpha")).toStrictEqual(move(state.snakes[0]!.heading));
  expect(() => snakeRules.defaultAction(state, "nobody")).toThrow(/Unknown/);
});

test("at the tick limit the living rank by length with ties, the dead after them", () => {
  const state = world([
    [
      [5, 5],
      [4, 5],
      [3, 5],
      [2, 5],
    ],
    [
      [10, 10],
      [10, 9],
      [10, 8],
      [10, 7],
    ],
    [
      [14, 2],
      [13, 2],
      [12, 2],
    ],
    [
      [2, 14],
      [3, 14],
      [4, 14],
    ],
  ]);
  eliminate(state, 3, 5);
  state.tick = 499;
  const output = step(state, { 2: move("down") });
  expect(resultOf(output)).toMatchObject({ reason: "tick-limit", completedTicks: 500 });
  expect(ranks(output)).toStrictEqual([
    [1, 4, true],
    [1, 4, true],
    [3, 3, true],
    [4, 0, false],
  ]);
  expect(snakeRules.observe(output.nextState, "alpha")).toBe(null);
  expect(() => snakeRules.step(output.nextState, {})).toThrow(/finished/);
});

test("the last survivor wins and the eliminated rank by death tick, later first", () => {
  const state = world([
    [
      [0, 5],
      [1, 5],
      [2, 5],
    ],
    [
      [10, 10],
      [10, 9],
      [10, 8],
    ],
    [
      [14, 2],
      [13, 2],
      [12, 2],
    ],
    [
      [2, 14],
      [3, 14],
      [4, 14],
    ],
  ]);
  eliminate(state, 3, 3);
  eliminate(state, 2, 5);
  const output = step(state, { 0: move("left") });
  expect(resultOf(output)).toMatchObject({ reason: "elimination", completedTicks: 6 });
  expect(ranks(output)).toStrictEqual([
    [2, 0, false],
    [1, 3, true],
    [3, 0, false],
    [4, 0, false],
  ]);
  expect(snakeRules.observe(output.nextState, "beta")).toBe(null);
});

test("snakes dying on the same tick share a rank", () => {
  const output = step(
    world([
      [
        [0, 5],
        [1, 5],
        [2, 5],
      ],
      [
        [10, 10],
        [10, 9],
        [10, 8],
      ],
      [
        [16, 2],
        [15, 2],
        [14, 2],
      ],
    ]),
    { 0: move("left"), 2: move("right") },
  );
  expect(ranks(output)).toStrictEqual([
    [2, 0, false],
    [1, 3, true],
    [2, 0, false],
  ]);
});
