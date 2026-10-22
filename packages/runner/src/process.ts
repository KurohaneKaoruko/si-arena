import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import type { ResourceLimits } from "@si-arena/protocol";
import { FramedChannel } from "./framing";
import { isolateProcess, type ProcessGroup } from "./isolation";
import { RunnerSystemError, type ProcessIsolation } from "./types";

export class RunnerProcess {
  readonly id = randomUUID();
  private child: ChildProcess | undefined;
  private channel: FramedChannel | undefined;
  private group: ProcessGroup | undefined;
  private exited: Promise<void> = Promise.resolve();
  private alive = false;
  private pending:
    | {
        receive: (message: Record<string, unknown>) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;
  get pid(): number | undefined {
    return this.child?.pid;
  }
  static async start(
    limits: ResourceLimits,
    isolation: ProcessIsolation,
    signal?: AbortSignal,
  ): Promise<RunnerProcess> {
    const host = new RunnerProcess();
    const cancel = () => host.stop();
    if (signal?.aborted) throw new RunnerSystemError("Match cancelled");
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await host.initialize(limits, isolation);
      return host;
    } catch (error) {
      await host.close();
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  private async initialize(limits: ResourceLimits, isolation: ProcessIsolation): Promise<void> {
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
        env: {
          LANG: "C.UTF-8",
          ...(sourceMode
            ? {
                TSX_TSCONFIG_PATH: fileURLToPath(
                  new URL("../../../configs/typescript/test.json", import.meta.url),
                ),
              }
            : {}),
        },
        stdio: ["ignore", "ignore", "ignore", "pipe"],
      },
    );
    this.child = child;
    this.alive = true;
    this.exited = new Promise((resolve) => child.once("close", resolve));
    const fail = () => {
      this.alive = false;
      const pending = this.pending;
      this.pending = undefined;
      if (!pending) return;
      clearTimeout(pending.timer);
      void (this.group?.wasOomKilled() ?? Promise.resolve(false)).then(
        (oom) =>
          pending.reject(
            new RunnerSystemError(
              oom ? "Match runner exceeded process memory budget" : "Match runner exited",
            ),
          ),
        () => pending.reject(new RunnerSystemError("Match runner exited")),
      );
    };
    child.on("error", fail);
    child.on("exit", fail);
    this.channel = new FramedChannel(
      child.stdio[3] as Duplex,
      limits.ipcBytes,
      (message) => {
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          this.stop();
          return;
        }
        this.pending?.receive(message as Record<string, unknown>);
      },
      () => this.stop(),
    );
    if (!child.pid) throw new RunnerSystemError("Match runner did not start");
    this.group = await isolateProcess(isolation, this.id, child.pid, limits.runnerMemoryBytes);
    await this.request(
      { kind: "initialize", codeBytes: limits.codeBytes },
      limits.startupMs,
      (m) => m.kind === "ready",
    );
  }
  request(
    value: Record<string, unknown>,
    timeoutMs: number,
    accept: (message: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    if (!this.alive || !this.channel)
      return Promise.reject(new RunnerSystemError("Match runner is unavailable"));
    if (this.pending)
      return Promise.reject(new RunnerSystemError("Concurrent runner requests are forbidden"));
    return new Promise((resolve, reject) => {
      const expired = () => {
        this.pending = undefined;
        this.stop();
        reject(new RunnerSystemError("Match runner stopped making progress"));
      };
      const timer = setTimeout(expired, timeoutMs);
      this.pending = {
        timer,
        reject,
        receive: (message) => {
          if (message.executionId !== this.id) return;
          try {
            if (message.kind === "system-error")
              throw new RunnerSystemError(
                typeof message.message === "string" ? message.message : "Match runner failed",
              );
            if (!accept(message)) {
              timer.refresh();
              return;
            }
            this.pending = undefined;
            clearTimeout(timer);
            resolve(message);
          } catch (error) {
            this.pending = undefined;
            clearTimeout(timer);
            this.stop();
            reject(error instanceof Error ? error : new RunnerSystemError("Invalid runner output"));
          }
        },
      };
      try {
        this.channel!.send({ ...value, executionId: this.id });
      } catch (error) {
        this.pending = undefined;
        clearTimeout(timer);
        this.stop();
        reject(
          error instanceof Error ? error : new RunnerSystemError("Cannot send runner request"),
        );
      }
    });
  }
  private stop(): void {
    this.alive = false;
    this.channel?.close();
    this.child?.kill("SIGKILL");
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new RunnerSystemError("Match runner was cancelled or stopped"));
    }
  }
  async close(): Promise<void> {
    this.stop();
    await this.exited;
    const group = this.group;
    this.group = undefined;
    await group?.close();
  }
}
