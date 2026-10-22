import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessIsolation } from "@si-arena/runner";

export interface WorkerConfig {
  databaseUrl: string;
  concurrency: number;
  replaysDir: string;
  isolation: ProcessIsolation;
}

export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Set DATABASE_URL before starting the worker.");
  const concurrency = Number(env.WORKER_CONCURRENCY ?? 2);
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("WORKER_CONCURRENCY must be a positive integer");
  }
  const isolationKind = env.WORKER_ISOLATION ?? "local";
  let isolation: ProcessIsolation;
  if (isolationKind === "cgroup-v2") {
    const root = env.WORKER_CGROUP_ROOT;
    if (root === undefined || !isAbsolute(root)) {
      throw new RangeError("WORKER_CGROUP_ROOT must be an absolute delegated cgroup directory");
    }
    isolation = { kind: "cgroup-v2", root };
  } else if (isolationKind === "local") {
    isolation = { kind: "local" };
  } else {
    throw new RangeError("WORKER_ISOLATION must be local or cgroup-v2");
  }
  return {
    databaseUrl,
    concurrency,
    replaysDir: resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
      env.REPLAYS_DIR ?? "data/replays",
    ),
    isolation,
  };
}
