import { expect, test } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { cloneJson, isJsonSnapshot, snapshotJson, stringifyJson, utf8Bytes } from "../src";

test("strict JSON rejects silent coercion, hooks, sparse arrays and cycles", () => {
  const sparse: unknown[] = [];
  sparse.length = 3;
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  for (const value of [
    undefined,
    Infinity,
    NaN,
    1n,
    new Date(),
    () => 1,
    sparse,
    cycle,
    { x: undefined },
    {
      toJSON() {
        return { forged: true };
      },
    },
    { [Symbol("x")]: 1 },
  ])
    expect(() => stringifyJson(value)).toThrow();
  let called = false;
  expect(() =>
    stringifyJson({
      get x() {
        called = true;
        return 1;
      },
    }),
  ).toThrow();
  expect(called).toBe(false);
});
test("JSON cloning preserves prototype keys, expands shared references, and checks UTF-8 bytes", () => {
  const shared = { x: 1 };
  const original = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
  const copied = cloneJson({ ...original, a: shared, b: shared });
  expect(Object.hasOwn(copied, "__proto__")).toBe(true);
  expect(copied.a).toEqual(copied.b);
  expect(copied.a).not.toBe(copied.b);
  for (const text of ["ASCII", "你好", "🌟", "\ud800", "\udc00"])
    expect(utf8Bytes(text)).toBe(Buffer.byteLength(text));
  expect(() => stringifyJson("🌟", { maxBytes: 5 })).toThrow();
});

test("strict JSON rejects hidden properties and accessors without evaluating them", () => {
  let called = false;
  const getter = () => {
    called = true;
    throw new Error("Getter must not run");
  };
  for (const value of [
    Object.defineProperty({ x: 1 }, "hidden", { value: 2 }),
    Object.defineProperty({ x: 1 }, "hidden", { get: getter }),
    Object.defineProperty({ x: 1 }, Symbol("hidden"), { value: 2 }),
    Object.defineProperty([1], "hidden", { value: 2 }),
  ]) {
    expect(() => stringifyJson(value)).toThrow();
    expect(() => cloneJson(value)).toThrow();
  }
  expect(called).toBe(false);
});

test("bounded JSON encoding rejects huge sparse arrays and preserves literal prototype keys", () => {
  const sparse: unknown[] = [];
  sparse.length = 100_000_000;
  expect(() => stringifyJson(sparse, { maxBytes: 64 })).toThrow();
  expect(stringifyJson(JSON.parse('{"__proto__":{"x":1}}'), { maxBytes: 64 })).toBe(
    '{"__proto__":{"x":1}}',
  );
});

test("direct cloning matches JSON encoding, exact byte budgets, and normalizes prototypes and -0", () => {
  const nullPrototype = Object.assign(Object.create(null), { x: 1 });
  const values = [
    null,
    true,
    false,
    -0,
    -9,
    -1,
    1,
    9,
    10,
    -10,
    1e-7,
    1e21,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    "",
    "你好🌟",
    "\ud800",
    "\udc00",
    '\u0000\n\t"\\',
    nullPrototype,
    { "10": "ten", "2": "two", nested: [false, null, -0, { text: "🌟\u0000" }] },
    JSON.parse('{"__proto__":{"x":1},"constructor":{"prototype":{"y":2}}}'),
  ];
  for (const value of values) {
    const encoded = stringifyJson(value);
    const bytes = Buffer.byteLength(encoded);
    const copied = cloneJson(value, bytes);
    // A literal object-valued "constructor" key is data, not a class identity.
    expect(isDeepStrictEqual(copied, JSON.parse(encoded))).toBe(true);
    expect(() => cloneJson(value, bytes - 1)).toThrow(RangeError);
    expect(stringifyJson(copied)).toBe(encoded);
    const snapshot = snapshotJson(value, bytes);
    expect(isDeepStrictEqual(snapshot, JSON.parse(encoded))).toBe(true);
    expect(() => snapshotJson(value, bytes - 1)).toThrow(RangeError);
    // Reused snapshots keep charging their full encoded size.
    expect(() => snapshotJson([snapshot], bytes + 1)).toThrow(RangeError);
    expect(snapshotJson([snapshot], bytes + 2)[0]).toBe(snapshot);
  }
  expect(Object.is(cloneJson(-0), -0)).toBe(false);
  expect(Object.getPrototypeOf(cloneJson(nullPrototype))).toBe(Object.prototype);
  expect(Object.getPrototypeOf(cloneJson([1, 2]))).toBe(Array.prototype);
});

test("direct cloning rejects invalid nested JSON and never calls accessors or toJSON", () => {
  let calls = 0;
  const sparse = [1, 2, 3];
  delete sparse[1];
  const invalid = [
    undefined,
    NaN,
    Infinity,
    -Infinity,
    1n,
    Symbol("value"),
    () => 1,
    new Map(),
    new Uint8Array([1]),
    new Date(),
    sparse,
    Object.defineProperty([1], "extra", { value: 2, enumerable: true }),
    Object.defineProperty([1], "0", {
      get() {
        calls++;
        return 1;
      },
      enumerable: true,
    }),
    {
      toJSON() {
        calls++;
        return "forged";
      },
    },
    {
      get value() {
        calls++;
        return 1;
      },
    },
  ];
  for (const value of invalid) {
    expect(() => cloneJson({ value })).toThrow();
    expect(() => snapshotJson({ value })).toThrow();
  }
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  expect(() => cloneJson(cycle)).toThrow();
  expect(calls).toBe(0);
});

test("snapshots are deep-frozen, shared without re-walking, and thaw into detached copies", () => {
  const grid = [0, 1, -1];
  const snapshot = snapshotJson({ board: { grid }, players: [{ id: "a" }] });
  expect(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.board.grid)).toBe(true);
  expect(snapshot.board.grid).not.toBe(grid);
  expect(isJsonSnapshot(snapshot.players[0])).toBe(true);
  expect(isJsonSnapshot(grid)).toBe(false);
  // A new wrapper around snapshot children reuses them by reference.
  const view = snapshotJson({ grid: snapshot.board.grid, extra: 1 });
  expect(view.grid).toBe(snapshot.board.grid);
  expect(snapshotJson(snapshot)).toBe(snapshot);
  // Only protocol-built copies become snapshots, even for caller-frozen input.
  const frozen = Object.freeze([1, Object.freeze({ x: 2 })]);
  expect(snapshotJson(frozen)).not.toBe(frozen);
  expect(snapshotJson(frozen)).toStrictEqual(frozen);
  expect(isJsonSnapshot(frozen)).toBe(false);
  const negative = Object.freeze([-0]);
  expect(Object.is(snapshotJson(negative)[0], 0)).toBe(true);
  const bare = Object.freeze(Object.assign(Object.create(null), { x: 1 }));
  expect(Object.getPrototypeOf(snapshotJson(bare))).toBe(Object.prototype);
  // cloneJson never hands out shared or frozen data.
  const thawed = cloneJson({ a: snapshot, b: snapshot });
  expect(thawed.a).toStrictEqual(thawed.b);
  expect(thawed.a).not.toBe(thawed.b);
  expect(Object.isFrozen(thawed.a.board.grid)).toBe(false);
  (thawed.a.board.grid as number[])[0] = 9;
  expect(snapshot.board.grid[0]).toBe(0);
  const literal = snapshotJson(JSON.parse('{"__proto__":{"x":1}}') as Record<string, unknown>);
  const copied = cloneJson(literal);
  expect(Object.hasOwn(copied, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
});

test("cached snapshot encoding preserves canonical order, hooks policy and exact byte ceilings", () => {
  const value = snapshotJson({
    z: [-1, 0, 1, 1e30],
    a: { text: "你好🌟\ud800\n", toJSON: "data" },
  });
  const ordinary = stringifyJson(value);
  expect(stringifyJson(value)).toBe(ordinary);
  expect(() => stringifyJson(value, { maxBytes: utf8Bytes(ordinary) - 1 })).toThrow(RangeError);
  expect(stringifyJson(value, { canonical: true })).toMatch(/^\{"a":/);
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  let polluted: string;
  try {
    // oxlint-disable-next-line no-extend-native -- Regression test for inherited serialization hooks.
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value: () => ({ forged: true }),
    });
    polluted = stringifyJson(snapshotJson({ numbers: [1, 2], nested: { ok: true } }));
  } finally {
    // oxlint-disable-next-line no-extend-native -- Restore the original prototype after the test.
    if (original) Object.defineProperty(Object.prototype, "toJSON", original);
    else Reflect.deleteProperty(Object.prototype, "toJSON");
  }
  expect(polluted).toBe('{"numbers":[1,2],"nested":{"ok":true}}');
});
