import { mkdir, readFile, rmdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ProcessIsolation } from "./types";
import { RunnerSystemError } from "./types";

export interface ProcessGroup {
  wasOomKilled(): Promise<boolean>;
  close(): Promise<void>;
}

/** Caller supplies a delegated cgroup v2 directory, never a path from player input. */
export async function isolateProcess(
  isolation: ProcessIsolation,
  id: string,
  pid: number,
  bytes: number,
): Promise<ProcessGroup> {
  if (isolation.kind === "local") return { wasOomKilled: async () => false, close: async () => {} };
  if (process.platform !== "linux" || !isAbsolute(isolation.root))
    throw new RunnerSystemError("cgroup-v2 requires Linux and an absolute delegated directory");
  const path = join(isolation.root, `arena-${id}`);
  try {
    await mkdir(path);
    // Read a kernel-provided control before writing: an ordinary directory is not isolation.
    await readFile(join(path, "cgroup.controllers"), "utf8");
    await writeFile(join(path, "memory.max"), String(bytes));
    await writeFile(join(path, "memory.swap.max"), "0");
    await writeFile(join(path, "memory.oom.group"), "1");
    // Node 26 idles at ~7 threads; isolated-vm adds its own pool (12 seen with
    // isolate churn). The pids controller counts threads, so leave headroom.
    await writeFile(join(path, "pids.max"), "64");
    await writeFile(join(path, "cgroup.procs"), String(pid));
  } catch {
    await rmdir(path).catch(() => {});
    throw new RunnerSystemError("Cannot establish independent cgroup resource limits");
  }
  return {
    wasOomKilled: async () => {
      const events = await readFile(join(path, "memory.events"), "utf8");
      return /^oom_kill [1-9][0-9]*$/m.test(events);
    },
    close: async () => {
      await rmdir(path);
    },
  };
}
