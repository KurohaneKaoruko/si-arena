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
