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

export function runGuest(
  input: ExecuteTickInput,
  sdkSource: string,
  logBytes: number,
  onLog: (log: PlayerLog) => void,
  onTruncated: () => void,
): RuntimeOutput {
  return withRuntime(input.limits, (context, keep, unwrap, resourceFailure, mark) => {
    const emit = keep(
      context.newFunction("emitLog", (level, message) => {
        // Only primitives from our formatter cross the boundary, never guest objects.
        if (context.typeof(level) !== "string" || context.typeof(message) !== "string")
          throw new Error("Invalid trusted logger output");
        const name = context.getString(level);
        if (name === "__truncated") {
          onTruncated();
          return;
        }
        onLog({ level: name as PlayerLog["level"], message: context.getString(message) });
      }),
    );
    const config = JSON.stringify({
      observation: input.observation,
      memory: input.memory,
      limits: input.limits,
      captureLogs: input.captureLogs,
      logBytes,
    });
    const factory = unwrap(context.evalCode(BOOTSTRAP, "arena-bootstrap.js", { type: "global" }));
    const configHandle = unwrap(
      context.evalCode(`JSON.parse(${JSON.stringify(config)})`, "arena-input.js", {
        type: "global",
      }),
    );
    const boot = unwrap(context.callFunction(factory, context.undefined, configHandle, emit));
    const run = keep(context.getProp(boot, "run"));
    const diagnose = keep(context.getProp(boot, "diagnose"));
    mark("bootstrapUs");
    let sdk: QuickJSHandle;
    try {
      const module = unwrap(context.evalCode(sdkSource, "arena-sdk.js", { type: "module" }));
      sdk = keep(context.getProp(module, "default"));
      mark("sdkUs");
    } catch {
      throw new Error("Trusted SDK failed to initialize");
    }
    try {
      checkSource(input.source);
      const module = unwrap(context.evalCode(input.source, "player.js", { type: "module" }));
      const entry = keep(context.getProp(module, "default"));
      mark("sourceUs");
      const output = unwrap(context.callFunction(run, context.undefined, entry, sdk));
      mark("entryAndSerializationUs");
      const failure = resourceFailure();
      if (failure) return JSON.stringify({ ok: false, error: failure });
      if (context.typeof(output) !== "string")
        throw new Error("Trusted serializer returned a non-string");
      const text = context.getString(output);
      if (Buffer.byteLength(text) > input.limits.resultBytes)
        return JSON.stringify({
          ok: false,
          error: { type: "INVALID_ACTION", message: "Execution result exceeds byte limit" },
        });
      return text;
    } catch (error) {
      const failure = resourceFailure();
      if (failure) return JSON.stringify({ ok: false, error: failure });
      if (error instanceof GuestFault) {
        const output = unwrap(context.callFunction(diagnose, context.undefined, error.handle));
        return context.getString(output);
      }
      if (error instanceof SyntaxError || error instanceof RangeError)
        return JSON.stringify({
          ok: false,
          error: { type: "ENTRYPOINT_ERROR", message: "Invalid or unsupported player module" },
        });
      throw error;
    }
  });
}

export function compileSource(source: string, limits: ResourceLimits): RuntimeOutput {
  return withRuntime(limits, (context, _keep, unwrap) => {
    try {
      checkSource(source);
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

function withRuntime(
  limits: ResourceLimits,
  execute: (
    context: ReturnType<QuickJSWASMModule["newContext"]>,
    keep: (handle: QuickJSHandle) => QuickJSHandle,
    unwrap: (result: ReturnType<QuickJSContext["evalCode"]>) => QuickJSHandle,
    resourceFailure: () => ExecutionError | undefined,
    mark: (phase: string) => void,
  ) => string,
): RuntimeOutput {
  flags["_arena_reset_failure"]();
  const started = process.threadCpuUsage();
  let cpuFailed = false;
  const cpu = () => {
    const usage = process.threadCpuUsage(started);
    return usage.user + usage.system;
  };
  const profile: Record<string, number> = {};
  let previous = 0;
  const mark = (phase: string) => {
    const now = cpu();
    profile[phase] = now - previous;
    previous = now;
  };
  const failure = (): ExecutionError | undefined => {
    if (cpu() > limits.cpuMs * 1000) cpuFailed = true;
    const native = flags["_arena_get_failure"]();
    if (native & 1) return { type: "HEAP_LIMIT", message: "QuickJS allocation limit exceeded" };
    if (native & 2) return { type: "STACK_LIMIT", message: "QuickJS stack limit exceeded" };
    if (cpuFailed) return { type: "CPU_LIMIT", message: "Tick CPU budget exceeded" };
    return undefined;
  };
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(limits.heapBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.setInterruptHandler(() => {
    if (cpu() > limits.cpuMs * 1000) cpuFailed = true;
    return cpuFailed || flags["_arena_get_failure"]() !== 0;
  });
  runtime.setModuleLoader(() => ({ error: new Error("Module imports are disabled") }));
  const handles: QuickJSHandle[] = [];
  const keep = (handle: QuickJSHandle) => {
    handles.push(handle);
    return handle;
  };
  let context: ReturnType<typeof runtime.newContext> | undefined;
  try {
    context = runtime.newContext();
    mark("runtimeAndContextUs");
    const unwrap = (result: ReturnType<QuickJSContext["evalCode"]>): QuickJSHandle => {
      if (result.error) throw new GuestFault(keep(result.error));
      return keep(result.value);
    };
    let payload: string;
    try {
      payload = execute(context, keep, unwrap, failure, mark);
    } catch (error) {
      const resource = failure();
      if (!resource) throw error;
      payload = JSON.stringify({ ok: false, error: resource });
    }
    const resource = failure();
    if (resource) payload = JSON.stringify({ ok: false, error: resource });
    return { payload, cpuUsedUs: cpu(), profile };
  } finally {
    mark("outputUs");
    for (const handle of handles.toReversed()) if (handle.alive) handle.dispose();
    context?.dispose();
    runtime.dispose();
    mark("teardownUs");
  }
}
