import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { isolateProcess, type ProcessGroup } from "../src/isolation";

const root = process.env.ARENA_TEST_CGROUP_ROOT;
test.runIf(process.platform === "linux" && Boolean(root))(
  "a real independent cgroup kills an oversized process without killing its supervisor",
  async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const a=[];process.stdin.once('data',()=>{setInterval(()=>a.push(Buffer.alloc(8*1024*1024,1)),5)})`,
      ],
      { stdio: ["pipe", "ignore", "ignore"], env: {} },
    );
    const exited = once(child, "exit");
    let group: ProcessGroup | undefined;
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      group = await isolateProcess(
        { kind: "cgroup-v2", root: root! },
        randomUUID(),
        child.pid!,
        64 * 1024 * 1024,
      );
      child.stdin!.write("start");
      const [, signal] = await exited;
      expect(signal).toBe("SIGKILL");
      expect(await group.wasOomKilled()).toBe(true);
    } finally {
      clearTimeout(watchdog);
      child.kill("SIGKILL");
      await exited;
      await group?.close();
    }
  },
  10000,
);
