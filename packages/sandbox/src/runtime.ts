import { createRequire } from "node:module";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSHandle,
  type QuickJSContext,
  type QuickJSWASMModule,
  type QuickJSSyncVariant,
} from "quickjs-emscripten-core";
import type {
  ExecuteTickInput,
  ExecutionError,
  PlayerLog,
  ResourceLimits,
} from "@si-arena/protocol";
import { BOOTSTRAP } from "./bootstrap";
import { checkSource } from "./source";

type Loader = Awaited<ReturnType<QuickJSSyncVariant["importModuleLoader"]>>;
interface FailureFlags {
  _arena_get_failure(): number;
  _arena_reset_failure(): void;
}
let quickjs: QuickJSWASMModule;
let flags: FailureFlags;

export async function initializeRuntime(): Promise<void> {
  const loader = createRequire(import.meta.url)("../runtime/quickjs.cjs") as Extract<
    Loader,
    (...args: never[]) => unknown
  >;
  if (typeof loader !== "function") throw new Error("Invalid native module loader");
  quickjs = await newQuickJSWASMModuleFromVariant({
    ...variant,
    importModuleLoader: async () => async (options) => {
      const module = await loader(options);
      flags = module as typeof module & FailureFlags;
      if (typeof flags["_arena_get_failure"] !== "function")
        throw new Error("Missing native failure latch");
      return module;
    },
  });
}

class GuestFault {
  constructor(readonly handle: QuickJSHandle) {}
}
export interface RuntimeOutput {
  payload: string;
  cpuUsedUs: number;
  /** Internal benchmark data; not authoritative game/replay state. */
  profile: Record<string, number>;
}

let validatedSource: string | null = null;

/** One player's volatile VM. Only the parent owns committed JSON Memory. */
export class GuestSession {
  private vm: MeteredRuntime | undefined;
  private begin: QuickJSHandle | undefined;
  private run: QuickJSHandle | undefined;
  private prepare: QuickJSHandle | undefined;
  private diagnose: QuickJSHandle | undefined;
  private sdk: QuickJSHandle | undefined;
  private entry: QuickJSHandle | undefined;
  private binding:
    | (Pick<ExecuteTickInput, "matchId" | "playerId" | "executionId" | "source" | "captureLogs"> & {
        sdkSource: string;
        limitsKey: string;
      })
    | undefined;
  private onLog: (log: PlayerLog) => void = () => {};
  private onTruncated: () => void = () => {};

  execute(
    input: ExecuteTickInput,
    sdkSource: string,
    logBytes: number,
    onLog: (log: PlayerLog) => void,
    onTruncated: () => void,
  ): RuntimeOutput {
    const limitsKey = JSON.stringify(input.limits);
    const bound = this.binding;
    if (
      bound &&
      (input.matchId !== bound.matchId ||
        input.playerId !== bound.playerId ||
        input.executionId !== bound.executionId ||
        input.source !== bound.source ||
        sdkSource !== bound.sdkSource ||
        input.captureLogs !== bound.captureLogs ||
        limitsKey !== bound.limitsKey)
    )
      throw new Error("A guest session cannot change its player or release");
    this.binding ??= {
      matchId: input.matchId,
      playerId: input.playerId,
      executionId: input.executionId,
      source: input.source,
      captureLogs: input.captureLogs,
      sdkSource,
      limitsKey,
    };
    if (input.source !== validatedSource) {
      try {
        checkSource(input.source);
      } catch (error) {
        if (!(error instanceof SyntaxError || error instanceof RangeError)) throw error;
        return {
          payload: JSON.stringify({
            ok: false,
            error: {
              type: "ENTRYPOINT_ERROR",
              message: "Invalid or unsupported player module",
            },
          }),
          cpuUsedUs: 0,
          profile: {},
        };
      }
      validatedSource = input.source;
    }
    this.onLog = onLog;
    this.onTruncated = onTruncated;
    const warm = this.vm !== undefined;
    const vm = (this.vm ??= new MeteredRuntime(input.limits));
    if (warm) vm.startTick();
    const { context } = vm;
    const tickHandles: QuickJSHandle[] = [];
    const keep = (handle: QuickJSHandle) => {
      tickHandles.push(handle);
      return handle;
    };
    const unwrap = (result: ReturnType<QuickJSContext["evalCode"]>) => {
      if (result.error) throw new GuestFault(keep(result.error));
      return keep(result.value);
    };
    let succeeded = false;
    try {
      if (!warm) {
        const emit = vm.keep(
          context.newFunction("emitLog", (level, message) => {
            if (context.typeof(level) !== "string" || context.typeof(message) !== "string")
              throw new Error("Invalid trusted logger output");
            const name = context.getString(level);
            if (name === "__truncated") this.onTruncated();
            else
              this.onLog({
                level: name as PlayerLog["level"],
                message: context.getString(message),
              });
          }),
        );
        const factory = unwrap(
          context.evalCode(BOOTSTRAP, "arena-bootstrap.js", { type: "global" }),
        );
        const boot = unwrap(context.callFunction(factory, context.undefined, emit));
        this.begin = vm.keep(context.getProp(boot, "begin"));
        this.run = vm.keep(context.getProp(boot, "run"));
        this.prepare = vm.keep(context.getProp(boot, "prepare"));
        this.diagnose = vm.keep(context.getProp(boot, "diagnose"));
      }
      const config = keep(
        context.newString(
          JSON.stringify({
            observation: input.observation,
            memory: input.memory,
            limits: input.limits,
            captureLogs: input.captureLogs,
            logBytes,
          }),
        ),
      );
      // The parser is captured inside the trusted closure before player code ever runs.
      unwrap(context.callFunction(this.begin!, context.undefined, config));
      vm.mark("bootstrapUs");
      if (!warm) {
        try {
          const module = unwrap(context.evalCode(sdkSource, "arena-sdk.js", { type: "module" }));
          this.sdk = vm.keep(context.getProp(module, "default"));
          if (context.typeof(this.sdk) !== "function")
            throw new Error("Trusted SDK must export a game API factory");
        } catch {
          throw new Error("Trusted SDK failed to initialize");
        }
      }
      // Only the trusted factory receives the submission channel. All methods
      // and command collection stay inside QuickJS; no per-command host callbacks.
      unwrap(context.callFunction(this.prepare!, context.undefined, this.sdk!));
      vm.mark("sdkUs");
      vm.enterGuest();
      let payload: string;
      try {
        if (!this.entry) {
          const module = unwrap(context.evalCode(input.source, "player.js", { type: "module" }));
          this.entry = vm.keep(context.getProp(module, "default"));
        }
        vm.mark("sourceUs");
        const output = unwrap(context.callFunction(this.run!, context.undefined, this.entry));
        vm.mark("entryAndSerializationUs");
        const failure = vm.failure();
        if (failure) payload = JSON.stringify({ ok: false, error: failure });
        else {
          if (context.typeof(output) !== "string")
            throw new Error("Trusted serializer returned a non-string");
          payload = context.getString(output);
          if (Buffer.byteLength(payload) > input.limits.resultBytes)
            payload = JSON.stringify({
              ok: false,
              error: {
                type: "INVALID_ACTION",
                message: "Execution result exceeds byte limit",
              },
            });
        }
      } catch (error) {
        const failure = vm.failure();
        if (failure) payload = JSON.stringify({ ok: false, error: failure });
        else if (error instanceof GuestFault) {
          const output = unwrap(
            context.callFunction(this.diagnose!, context.undefined, error.handle),
          );
          payload = context.getString(output);
        } else throw error;
      }
      const failure = vm.failure();
      if (failure) payload = JSON.stringify({ ok: false, error: failure });
      const result = { payload, cpuUsedUs: vm.billedCpu(), profile: vm.profile };
      succeeded = (JSON.parse(payload) as { ok: boolean }).ok;
      return result;
    } catch (error) {
      // A retained player heap can exhaust the next tick's input allocation.
      // Cold trusted initialization failures remain system errors.
      const failure = warm || vm.inGuest ? vm.failure() : undefined;
      if (!failure) throw error;
      return {
        payload: JSON.stringify({ ok: false, error: failure }),
        cpuUsedUs: vm.billedCpu(),
        profile: vm.profile,
      };
    } finally {
      vm.mark("outputUs");
      for (const handle of tickHandles.toReversed()) if (handle.alive) handle.dispose();
      this.onLog = () => {};
      this.onTruncated = () => {};
      if (!succeeded) this.close();
      vm.mark("teardownUs");
    }
  }

  close(): void {
    const vm = this.vm;
    this.vm = undefined;
    this.begin = this.prepare = this.run = this.diagnose = this.sdk = this.entry = undefined;
    vm?.close();
  }
}

/** Cold-call probe for internal benchmarks; production owns a GuestSession per player. */
export function runGuest(
  input: ExecuteTickInput,
  sdkSource: string,
  logBytes: number,
  onLog: (log: PlayerLog) => void,
  onTruncated: () => void,
): RuntimeOutput {
  const session = new GuestSession();
  try {
    return session.execute(input, sdkSource, logBytes, onLog, onTruncated);
  } finally {
    session.close();
  }
}

export function compileSource(source: string, limits: ResourceLimits): RuntimeOutput {
  // Same policy-check placement as runGuest: unbilled, so large valid sources are
  // never rejected because parsing burned the validation CPU budget.
  try {
    checkSource(source);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError) {
      return {
        payload: JSON.stringify({
          ok: false,
          error: { type: "ENTRYPOINT_ERROR", message: "Invalid or unsupported player module" },
        }),
        cpuUsedUs: 0,
        profile: {},
      };
    }
    throw error;
  }
  return withRuntime(limits, (context, _keep, unwrap, _resourceFailure, _mark, enterGuest) => {
    // Compiling untrusted player source is guest work: heap or CPU exhaustion
    // here is attributable to the player's source.
    enterGuest();
    try {
      unwrap(context.evalCode(source, "player.js", { type: "module", compileOnly: true }));
      return '{"ok":true}';
    } catch {
      return JSON.stringify({
        ok: false,
        error: { type: "ENTRYPOINT_ERROR", message: "Invalid or unsupported player module" },
      });
    }
  });
}

class MeteredRuntime {
  private started = process.threadCpuUsage();
  private guestStartedUs = 0;
  private cpuFailed = false;
  private previous = 0;
  private readonly handles: QuickJSHandle[] = [];
  readonly runtime: ReturnType<QuickJSWASMModule["newRuntime"]>;
  readonly context: QuickJSContext;
  profile: Record<string, number> = {};
  inGuest = false;

  constructor(private readonly limits: ResourceLimits) {
    flags["_arena_reset_failure"]();
    this.runtime = quickjs.newRuntime();
    this.runtime.setMemoryLimit(limits.heapBytes);
    this.runtime.setMaxStackSize(limits.stackBytes);
    this.runtime.setInterruptHandler(() => {
      if (this.inGuest && this.billedCpu() > limits.cpuMs * 1000) this.cpuFailed = true;
      return this.cpuFailed || flags["_arena_get_failure"]() !== 0;
    });
    this.runtime.setModuleLoader(() => ({ error: new Error("Module imports are disabled") }));
    try {
      this.context = this.runtime.newContext();
    } catch (error) {
      this.runtime.dispose();
      throw error;
    }
    this.mark("runtimeAndContextUs");
  }

  startTick(): void {
    flags["_arena_reset_failure"]();
    this.started = process.threadCpuUsage();
    this.guestStartedUs = this.previous = 0;
    this.inGuest = this.cpuFailed = false;
    this.profile = { runtimeAndContextUs: 0 };
  }
  private cpu(): number {
    const usage = process.threadCpuUsage(this.started);
    return usage.user + usage.system;
  }
  billedCpu(): number {
    return this.inGuest ? this.cpu() - this.guestStartedUs : 0;
  }
  enterGuest(): void {
    this.guestStartedUs = this.cpu();
    this.inGuest = true;
  }
  mark(phase: string): void {
    const now = this.cpu();
    this.profile[phase] = now - this.previous;
    this.previous = now;
  }
  failure(): ExecutionError | undefined {
    if (this.billedCpu() > this.limits.cpuMs * 1000) this.cpuFailed = true;
    const native = flags["_arena_get_failure"]();
    if (native & 1) return { type: "HEAP_LIMIT", message: "QuickJS allocation limit exceeded" };
    if (native & 2) return { type: "STACK_LIMIT", message: "QuickJS stack limit exceeded" };
    if (this.cpuFailed) return { type: "CPU_LIMIT", message: "Tick CPU budget exceeded" };
    return undefined;
  }
  keep(handle: QuickJSHandle): QuickJSHandle {
    this.handles.push(handle);
    return handle;
  }
  close(): void {
    for (const handle of this.handles.toReversed()) if (handle.alive) handle.dispose();
    this.context.dispose();
    this.runtime.dispose();
  }
}

function withRuntime(
  limits: ResourceLimits,
  execute: (
    context: QuickJSContext,
    keep: (handle: QuickJSHandle) => QuickJSHandle,
    unwrap: (result: ReturnType<QuickJSContext["evalCode"]>) => QuickJSHandle,
    resourceFailure: () => ExecutionError | undefined,
    mark: (phase: string) => void,
    enterGuest: () => void,
  ) => string,
): RuntimeOutput {
  const vm = new MeteredRuntime(limits);
  const keep = (handle: QuickJSHandle) => vm.keep(handle);
  const unwrap = (result: ReturnType<QuickJSContext["evalCode"]>) => {
    if (result.error) throw new GuestFault(keep(result.error));
    return keep(result.value);
  };
  try {
    let payload: string;
    try {
      payload = execute(
        vm.context,
        keep,
        unwrap,
        () => vm.failure(),
        (phase) => vm.mark(phase),
        () => vm.enterGuest(),
      );
    } catch (error) {
      const failure = vm.inGuest ? vm.failure() : undefined;
      if (!failure) throw error;
      payload = JSON.stringify({ ok: false, error: failure });
    }
    const failure = vm.inGuest ? vm.failure() : undefined;
    if (failure) payload = JSON.stringify({ ok: false, error: failure });
    return { payload, cpuUsedUs: vm.billedCpu(), profile: vm.profile };
  } finally {
    vm.mark("outputUs");
    vm.close();
    vm.mark("teardownUs");
  }
}
