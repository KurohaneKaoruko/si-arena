import { expect, test } from "vitest";
import { cloneJson, stringifyJson, utf8Bytes } from "../src";

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
