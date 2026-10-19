import type { ResourceLimitOverrides } from "../src/index";
import { test, expect } from "vitest";
import { DEFAULT_RESOURCE_LIMITS, resolveResourceLimits } from "../src/index";

// Deliberately bypass static types for malformed JSON boundary tests.
const resolveUnknown = (value: unknown) => resolveResourceLimits(value as ResourceLimitOverrides);

test("game overrides inherit nested log limits and do not mutate other games", () => {
  const limits = resolveResourceLimits({ cpuMs: 40, logs: { tickLines: 64 } });
  expect(limits.cpuMs).toBe(40);
  expect(limits.logs.tickLines).toBe(64);
  expect(limits.logs.tickBytes).toBe(8192);
  limits.logs.tickLines = 99;
  expect(resolveResourceLimits().logs.tickLines).toBe(32);
  expect(DEFAULT_RESOURCE_LIMITS.cpuMs).toBe(20);
});

test("larger Memory requires a result budget that can actually carry it", () => {
  expect(() => resolveResourceLimits({ memoryBytes: 128 * 1024 })).toThrow(/resultBytes/);
  const limits = resolveResourceLimits({ memoryBytes: 128 * 1024, resultBytes: 192 * 1024 });
  expect(limits.memoryBytes).toBe(128 * 1024);
});

test("invalid and contradictory resource configurations fail instead of silently clamping", () => {
  for (const value of [0, -1, null, Infinity, NaN, 1.5]) {
    expect(() => resolveUnknown({ cpuMs: value })).toThrow();
  }
  expect(() => resolveResourceLimits({ cpuMs: 501 })).toThrow(/wallMs/);
  expect(() => resolveResourceLimits({ errorBytes: 64 })).toThrow(/diagnostic envelope/);
  expect(() => resolveResourceLimits({ heapBytes: 256 * 1024 * 1024 })).toThrow(
    /processMemoryBytes/,
  );
  expect(() => resolveUnknown({ unknown: 1 })).toThrow(/Unknown resource/);
  expect(() => resolveUnknown({ logs: { unknown: 1 } })).toThrow(/Unknown log/);
  expect(() => resolveUnknown({ logs: [] })).toThrow(/logs must be an object/);
  expect(() => resolveUnknown([])).toThrow(/limits must be an object/);
});
