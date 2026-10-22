import ivm from "isolated-vm";
import {
  truncateUtf8,
  stringifyJson,
  type ExecuteTickInput,
  type ExecutionError,
  type PlayerLog,
  type ResourceLimits,
} from "@si-arena/protocol";
import { BOOTSTRAP } from "./bootstrap";
import { checkSource } from "./source";

const MiB = 1024 * 1024;
/** isolated-vm refuses smaller isolates; the release heapBytes still bounds objects above it. */
const MIN_ISOLATE_MIB = 8;
const NO_IMPORTS = () => {
  throw new Error("Module imports are disabled");
};

export interface RuntimeOutput {
  payload: string;
  cpuUsedUs: number;
}

type GuestFunction = ivm.Reference<(...args: unknown[]) => unknown>;
type Bootstrap = ivm.Reference<Record<"run" | "prepare" | "tick", (...args: unknown[]) => unknown>>;

const ENTRYPOINT_INVALID = JSON.stringify({
  ok: false,
  error: { type: "ENTRYPOINT_ERROR", message: "Invalid or unsupported player module" },
});

/** Engine resource failures surface as RangeErrors in V8; map the uncaught ones to budget types. */
function resourceFailure(name: string, message: string): ExecutionError | undefined {
  if (name !== "RangeError") return undefined;
  if (message === "Maximum call stack size exceeded")
    return { type: "STACK_LIMIT", message: "Call stack limit exceeded" };
  if (/allocation failed|Invalid (?:array|string|typed array) length/.test(message))
    return { type: "HEAP_LIMIT", message: "Heap allocation limit exceeded" };
  return undefined;
}

/** One player's volatile VM. Only the parent owns committed JSON Memory. */
export class GuestSession {
  private vm: MeteredRuntime | undefined;
  private run: GuestFunction | undefined;
  private prepare: GuestFunction | undefined;
  private tick: GuestFunction | undefined;
  private sdk: GuestFunction | undefined;
  private entry: GuestFunction | undefined;
  private binding:
    | (Pick<ExecuteTickInput, "matchId" | "playerId" | "executionId" | "source" | "captureLogs"> & {
        sdkSource: string;
        limits: ResourceLimits;
      })
    | undefined;
  private onLog: (log: PlayerLog) => void = () => {};
  private onTruncated: () => void = () => {};

  private source: string | undefined;
  private validSource = false;

  prepareSource(source: string): void {
    if (this.source === source) return;
    this.source = source;
    try {
      checkSource(source);
      this.validSource = true;
    } catch (error) {
      if (!(error instanceof SyntaxError || error instanceof RangeError)) throw error;
      this.validSource = false;
    }
  }

  async execute(
    input: ExecuteTickInput,
    sdkSource: string,
    logBytes: number,
    onLog: (log: PlayerLog) => void,
    onTruncated: () => void,
  ): Promise<RuntimeOutput> {
    const bound = this.binding;
    if (
      bound &&
      (input.matchId !== bound.matchId ||
        input.playerId !== bound.playerId ||
        input.executionId !== bound.executionId ||
        input.source !== bound.source ||
        sdkSource !== bound.sdkSource ||
        input.captureLogs !== bound.captureLogs ||
        input.limits !== bound.limits)
    )
      throw new Error("A guest session cannot change its player or release");
    this.binding ??= {
      matchId: input.matchId,
      playerId: input.playerId,
      executionId: input.executionId,
      source: input.source,
      captureLogs: input.captureLogs,
      sdkSource,
      limits: input.limits,
    };
    this.prepareSource(input.source);
    if (!this.validSource) return { payload: ENTRYPOINT_INVALID, cpuUsedUs: 0 };
    this.onLog = onLog;
    this.onTruncated = onTruncated;
    const warm = this.vm !== undefined;
    const vm = (this.vm ??= new MeteredRuntime(input.limits));
    if (warm) vm.startTick();
    const { isolate, context } = vm;
    const deadline = performance.now() + input.limits.wallMs;
    const wall = () => ({ timeout: Math.max(1, Math.ceil(deadline - performance.now())) });
    const watchdog = setTimeout(() => vm.expireWall(), input.limits.wallMs);
    let succeeded = false;
    try {
      if (!warm) {
        const emit = new ivm.Callback(
          (level: unknown, message: unknown) => {
            if (typeof level !== "string" || typeof message !== "string")
              throw new Error("Invalid trusted logger output");
            if (level === "__truncated") this.onTruncated();
            else this.onLog({ level: level as PlayerLog["level"], message });
          },
          { sync: true },
        );
        const factory = context.evalSync(BOOTSTRAP, {
          reference: true,
          ...wall(),
        }) as GuestFunction;
        const beginBudget = new ivm.Callback(() => vm.beginGuest(), { sync: true });
        const boot = factory.applySync(undefined, [emit, beginBudget], {
          result: { reference: true },
          ...wall(),
        }) as Bootstrap;
        this.run = boot.getSync("run", { reference: true });
        this.prepare = boot.getSync("prepare", { reference: true });
        this.tick = boot.getSync("tick", { reference: true });
      }
      if (!warm) {
        try {
          const module = isolate.compileModuleSync(sdkSource, { filename: "arena-sdk.js" });
          module.instantiateSync(context, NO_IMPORTS);
          module.evaluateSync(wall());
          this.sdk = module.namespace.getSync("default", { reference: true }) as GuestFunction;
          if (this.sdk.typeof !== "function")
            throw new Error("Trusted SDK must export a game API factory");
        } catch {
          throw new Error("Trusted SDK failed to initialize");
        }
      }
      // Only the trusted factory receives the submission channel. All methods
      // and command collection stay inside the isolate; no per-command host callbacks.
      const config = stringifyJson({
        observation: input.observation,
        memory: input.memory,
        limits: input.limits,
        captureLogs: input.captureLogs,
        logBytes,
      });
      if (!warm) this.prepare!.applySync(undefined, [config, this.sdk!.derefInto()], wall());
      let payload: string;
      try {
        payload = await vm.guest(async () => {
          if (!this.entry) {
            let module: ivm.Module;
            try {
              module = isolate.compileModuleSync(input.source, { filename: "player.js" });
            } catch {
              return ENTRYPOINT_INVALID;
            }
            module.instantiateSync(context, NO_IMPORTS);
            await module.evaluate(wall());
            this.entry = module.namespace.getSync("default", { reference: true }) as GuestFunction;
          }
          const output: unknown = warm
            ? await this.tick!.apply(
                undefined,
                [config, this.sdk!.derefInto(), this.entry.derefInto()],
                wall(),
              )
            : await this.run!.apply(undefined, [this.entry.derefInto()], wall());
          if (typeof output !== "string")
            throw new Error("Trusted serializer returned a non-string");
          return output;
        }, warm);
        if (Buffer.byteLength(payload) > input.limits.resultBytes)
          payload = JSON.stringify({
            ok: false,
            error: { type: "INVALID_ACTION", message: "Execution result exceeds byte limit" },
          });
      } catch (error) {
        if (!vm.inGuest && !vm.failure()) throw error;
        payload = JSON.stringify({
          ok: false,
          error: vm.failure() ?? diagnose(error, input.limits),
        });
      }
      if (performance.now() > deadline) vm.expireWall();
      const failure = vm.failure();
      if (failure) payload = JSON.stringify({ ok: false, error: failure });
      succeeded = (JSON.parse(payload) as { ok: boolean }).ok;
      return { payload, cpuUsedUs: vm.billedCpuUs() };
    } catch (error) {
      // A retained player heap can exhaust the next tick's input allocation.
      // Cold trusted initialization failures remain system errors.
      const failure = warm || vm.inGuest ? vm.failure() : undefined;
      if (!failure) throw error;
      return {
        payload: JSON.stringify({ ok: false, error: failure }),
        cpuUsedUs: vm.billedCpuUs(),
      };
    } finally {
      clearTimeout(watchdog);
      this.onLog = () => {};
      this.onTruncated = () => {};
      if (!succeeded) this.close();
    }
  }

  close(): void {
    const vm = this.vm;
    this.vm = undefined;
    this.tick = this.prepare = this.run = this.sdk = this.entry = undefined;
    vm?.close();
  }
}

/** Errors escaping the guest without a trusted wrapper: top-level module code and engine terminations. */
function diagnose(error: unknown, limits: ResourceLimits): ExecutionError {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : "Player execution failed";
  const budget = Math.max(16, limits.errorBytes >> 3);
  if (message === "Script execution timed out.")
    return { type: "EXECUTION_TIMEOUT", message: "Tick wall time exceeded" };
  return (
    resourceFailure(name, message) ?? {
      type: "RUNTIME_ERROR",
      message: truncateUtf8(message, budget),
      name: truncateUtf8(name, 64),
      ...(error instanceof Error && typeof error.stack === "string"
        ? { stack: truncateUtf8(error.stack, budget) }
        : {}),
    }
  );
}

export function compileSource(source: string, limits: ResourceLimits): RuntimeOutput {
  // Same policy-check placement as the tick path: unbilled, so large valid
  // sources are never rejected because parsing burned the validation budget.
  try {
    checkSource(source);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError)
      return { payload: ENTRYPOINT_INVALID, cpuUsedUs: 0 };
    throw error;
  }
  const vm = new MeteredRuntime(limits);
  try {
    // Compiling never runs top-level code; the AST check already rejected imports.
    vm.isolate.compileModuleSync(source, { filename: "player.js" });
    return { payload: '{"ok":true}', cpuUsedUs: 0 };
  } catch {
    return { payload: ENTRYPOINT_INVALID, cpuUsedUs: 0 };
  } finally {
    vm.close();
  }
}

class MeteredRuntime {
  readonly isolate: ivm.Isolate;
  readonly context: ivm.Context;
  private guestStartNs = 0n;
  private lastCpuNs = 0n;
  private cpuFailed = false;
  private wallFailed = false;
  inGuest = false;

  constructor(private readonly limits: ResourceLimits) {
    this.isolate = new ivm.Isolate({
      memoryLimit: Math.max(MIN_ISOLATE_MIB, Math.ceil(limits.heapBytes / MiB)),
      // V8 cannot continue after an unrecoverable fault; the match process must fail.
      onCatastrophicError: () => process.exit(70),
    });
    this.context = this.isolate.createContextSync();
  }

  startTick(): void {
    this.guestStartNs = 0n;
    this.inGuest = this.cpuFailed = this.wallFailed = false;
  }
  private cpuNs(): bigint {
    if (!this.isolate.isDisposed) this.lastCpuNs = this.isolate.cpuTime;
    return this.lastCpuNs;
  }
  billedCpuUs(): number {
    return this.inGuest ? Number((this.cpuNs() - this.guestStartNs) / 1000n) : 0;
  }
  /**
   * Bill the isolate's own thread time from here on. isolated-vm only offers a
   * wall-clock interrupt, so a 1ms poll terminates the isolate once the CPU budget
   * is spent; the wall timeout and the parent watchdog remain as backstops.
   */
  beginGuest(): void {
    // The private bootstrap callback can start billing only once per tick.
    if (this.inGuest) return;
    this.guestStartNs = this.cpuNs();
    this.inGuest = true;
  }
  async guest<T>(work: () => Promise<T>, deferred = false): Promise<T> {
    if (!deferred) this.beginGuest();
    const budgetNs = BigInt(this.limits.cpuMs) * 1_000_000n;
    const poll = setInterval(() => {
      if (this.inGuest && this.cpuNs() - this.guestStartNs > budgetNs && !this.isolate.isDisposed) {
        this.cpuFailed = true;
        this.isolate.dispose();
      }
    }, 1);
    try {
      return await work();
    } finally {
      clearInterval(poll);
    }
  }
  expireWall(): void {
    this.wallFailed = true;
    if (!this.isolate.isDisposed) this.isolate.dispose();
  }
  failure(): ExecutionError | undefined {
    if (this.inGuest && this.billedCpuUs() > this.limits.cpuMs * 1000) this.cpuFailed = true;
    if (this.cpuFailed) return { type: "CPU_LIMIT", message: "Tick CPU budget exceeded" };
    if (this.wallFailed) return { type: "EXECUTION_TIMEOUT", message: "Tick wall time exceeded" };
    if (this.isolate.isDisposed)
      return { type: "HEAP_LIMIT", message: "Isolate heap limit exceeded" };
    return undefined;
  }
  close(): void {
    if (!this.isolate.isDisposed) this.isolate.dispose();
  }
}
