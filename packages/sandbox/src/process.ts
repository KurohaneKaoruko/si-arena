import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import type { ExecuteTickInput, ResourceLimits } from "@si-arena/protocol";
import { FramedChannel } from "./framing";
import { isRecord } from "./json";
import { isolateProcess, type ProcessGroup } from "./isolation";
import { SandboxSystemError, type ProcessIsolation } from "./types";

/** Per-match constants sent once per process instead of with every tick. */
export type ExecutorBinding = Pick<
  ExecuteTickInput,
  "matchId" | "playerId" | "source" | "limits" | "captureLogs"
> & { sdkSource: string };

export class ExecutorStopped extends Error {
  constructor(readonly reason: "EXECUTION_TIMEOUT" | "EXECUTOR_ERROR" | "HEAP_LIMIT") {
    super(reason);
  }
}

export class ExecutorProcess {
  readonly id = randomUUID();
  private child: ChildProcess | undefined;
  private channel: FramedChannel | undefined;
  private group: ProcessGroup | undefined;
  private alive = false;
  private pending:
    | {
        resolve: (value: Record<string, unknown>) => void;
        reject: (error: Error) => void;
        message: (value: Record<string, unknown>) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;
  private exited: Promise<void> = Promise.resolve();
  get pid(): number | undefined {
    return this.child?.pid;
  }
  get usable(): boolean {
    return this.alive;
  }

  static async start(
    limits: ResourceLimits,
    isolation: ProcessIsolation,
    binding?: ExecutorBinding,
  ): Promise<ExecutorProcess> {
    const executor = new ExecutorProcess();
    try {
      await executor.initialize(limits, isolation, binding);
      return executor;
    } catch (error) {
      await executor.close();
      throw error;
    }
  }

  private async initialize(
    limits: ResourceLimits,
    isolation: ProcessIsolation,
    binding: ExecutorBinding | undefined,
  ): Promise<void> {
    const startedAt = performance.now();
    const sourceMode = import.meta.url.endsWith(".ts");
    const entry = new URL(sourceMode ? "./child.ts" : "./child.js", import.meta.url);
    const child = spawn(
      process.execPath,
      [
        ...(sourceMode ? ["--import", import.meta.resolve("tsx")] : []),
        fileURLToPath(entry),
        String(limits.ipcBytes),
        this.id,
      ],
      {
        env: { LANG: "C.UTF-8" },
        stdio: ["ignore", "ignore", "ignore", "pipe"],
      },
    );
    this.child = child;
    this.alive = true;
    this.exited = new Promise((resolve) => child.once("close", resolve));
    const fail = () => {
      this.alive = false;
      const pending = this.pending;
      if (!pending) return;
      this.pending = undefined;
      clearTimeout(pending.timer);
      void (this.group?.wasOomKilled() ?? Promise.resolve(false)).then(
        (oom) => pending.reject(new ExecutorStopped(oom ? "HEAP_LIMIT" : "EXECUTOR_ERROR")),
        () => pending.reject(new ExecutorStopped("EXECUTOR_ERROR")),
      );
    };
    child.on("error", fail);
    child.on("exit", fail);
    const pipe = child.stdio[3] as Duplex;
    this.channel = new FramedChannel(
      pipe,
      limits.ipcBytes,
      (message) => {
        if (!isRecord(message)) {
          this.stop();
          return;
        }
        this.pending?.message(message);
      },
      () => this.stop(),
    );
    if (!child.pid) throw new SandboxSystemError("Executor did not start");
    this.group = await isolateProcess(isolation, this.id, child.pid, limits.processMemoryBytes);
    if (!this.alive) throw new SandboxSystemError("Executor exited before initialization");
    try {
      await this.request(
        { kind: "initialize", executionId: this.id },
        Math.max(1, limits.startupMs - (performance.now() - startedAt)),
        (message) => {
          if (message.executionId !== this.id) return false;
          if (message.kind === "ready") return true;
          throw new SandboxSystemError("Executor initialization failed");
        },
      );
      if (binding)
        await this.request(
          { kind: "bind", executionId: this.id, ...binding },
          Math.max(1, limits.startupMs - (performance.now() - startedAt)),
          (message) => {
            if (message.executionId !== this.id) return false;
            if (message.kind === "bound") return true;
            throw new SandboxSystemError("Executor binding failed");
          },
        );
    } catch {
      throw new SandboxSystemError("Executor initialization failed or timed out");
    }
  }

  request(
    value: unknown,
    timeoutMs: number,
    accept: (message: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    if (!this.alive || !this.channel) return Promise.reject(new ExecutorStopped("EXECUTOR_ERROR"));
    if (this.pending)
      return Promise.reject(
        new SandboxSystemError("An executor can only run one request at a time"),
      );
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        this.stop();
        reject(new ExecutorStopped("EXECUTION_TIMEOUT"));
      }, timeoutMs);
      this.pending = {
        resolve,
        reject,
        timer,
        message: (message) => {
          try {
            if (!accept(message)) return;
            clearTimeout(timer);
            this.pending = undefined;
            resolve(message);
          } catch (error) {
            clearTimeout(timer);
            this.pending = undefined;
            this.stop();
            reject(
              error instanceof Error ? error : new SandboxSystemError("Invalid executor output"),
            );
          }
        },
      };
      try {
        this.channel!.send(value);
      } catch {
        clearTimeout(timer);
        this.pending = undefined;
        this.stop();
        reject(new SandboxSystemError("Cannot send bounded IPC request"));
      }
    });
  }

  private stop(): void {
    this.alive = false;
    this.channel?.close();
    this.child?.kill("SIGKILL");
    const pending = this.pending;
    if (pending) {
      this.pending = undefined;
      clearTimeout(pending.timer);
      pending.reject(new ExecutorStopped("EXECUTOR_ERROR"));
    }
  }

  async close(): Promise<void> {
    this.stop();
    await this.exited;
    const group = this.group;
    this.group = undefined;
    if (group) await group.close();
  }
}
