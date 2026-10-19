import { expect, test } from "vitest";
import { readWorkerConfig } from "../src/config";
import { fileURLToPath } from "node:url";

const base = { DATABASE_URL: "postgresql://localhost/si_arena" };

test("defaults mirror the deployment constants", () => {
  const config = readWorkerConfig({ ...base });
  expect(config).toEqual({
    databaseUrl: "postgresql://localhost/si_arena",
    concurrency: 2,
    replaysDir: fileURLToPath(new URL("../../../data/replays", import.meta.url)),
    isolation: { kind: "local" },
  });
});

test("DATABASE_URL is required", () => {
  expect(() => readWorkerConfig({})).toThrow(/DATABASE_URL/);
});

test("absolute replay directories are shared unchanged with the server", () => {
  expect(readWorkerConfig({ ...base, REPLAYS_DIR: "/tmp/si-arena-replays" }).replaysDir).toBe(
    "/tmp/si-arena-replays",
  );
});

test("rejects invalid concurrency values", () => {
  expect(() => readWorkerConfig({ ...base, WORKER_CONCURRENCY: "0" })).toThrow(RangeError);
  expect(() => readWorkerConfig({ ...base, WORKER_CONCURRENCY: "1.5" })).toThrow(RangeError);
});

test("cgroup isolation demands an absolute delegated root", () => {
  const config = readWorkerConfig({
    ...base,
    WORKER_ISOLATION: "cgroup-v2",
    WORKER_CGROUP_ROOT: "/sys/fs/cgroup/arena",
  });
  expect(config.isolation).toEqual({ kind: "cgroup-v2", root: "/sys/fs/cgroup/arena" });
  expect(() =>
    readWorkerConfig({ ...base, WORKER_ISOLATION: "cgroup-v2", WORKER_CGROUP_ROOT: "relative" }),
  ).toThrow(RangeError);
  expect(() => readWorkerConfig({ ...base, WORKER_ISOLATION: "cgroup-v2" })).toThrow(RangeError);
  expect(() => readWorkerConfig({ ...base, WORKER_ISOLATION: "jail" })).toThrow(RangeError);
});
