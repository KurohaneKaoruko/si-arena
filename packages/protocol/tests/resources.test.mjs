import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RESOURCE_LIMITS, resolveResourceLimits } from "../dist/index.js";

test("game overrides inherit nested log limits and do not mutate other games", () => {
  const limits = resolveResourceLimits({ cpuMs: 40, logs: { tickLines: 64 } });
  assert.equal(limits.cpuMs, 40);
  assert.equal(limits.logs.tickLines, 64);
  assert.equal(limits.logs.tickBytes, 8192);
  limits.logs.tickLines = 99;
  assert.equal(resolveResourceLimits().logs.tickLines, 32);
  assert.equal(DEFAULT_RESOURCE_LIMITS.cpuMs, 20);
});

test("larger Memory requires a result budget that can actually carry it", () => {
  assert.throws(() => resolveResourceLimits({ memoryBytes: 128 * 1024 }), /resultBytes/);
  const limits = resolveResourceLimits({ memoryBytes: 128 * 1024, resultBytes: 192 * 1024 });
  assert.equal(limits.memoryBytes, 128 * 1024);
});

test("invalid and contradictory resource configurations fail instead of silently clamping", () => {
  for (const value of [0, -1, null, Infinity, NaN, 1.5]) {
    assert.throws(() => resolveResourceLimits({ cpuMs: value }));
  }
  assert.throws(() => resolveResourceLimits({ cpuMs: 501 }), /wallMs/);
  assert.throws(
    () => resolveResourceLimits({ heapBytes: 256 * 1024 * 1024 }),
    /processMemoryBytes/,
  );
  assert.throws(() => resolveResourceLimits({ unknown: 1 }), /Unknown resource/);
  assert.throws(() => resolveResourceLimits({ logs: { unknown: 1 } }), /Unknown log/);
  assert.throws(() => resolveResourceLimits({ logs: [] }), /logs must be an object/);
  assert.throws(() => resolveResourceLimits([]), /limits must be an object/);
});
