import { afterEach, expect, test, vi } from "vitest";
import {
  resolveResourceLimits,
  type JsonValue,
  type ResourceLimitOverrides,
} from "@si-arena/protocol";
import { ExecutorProcess } from "../src/process";
import { MatchLogBudget, SandboxPlayer, SandboxSystemError, validateSource } from "../src/index";
import type { SandboxOptions } from "../src/index";

const players: SandboxPlayer<JsonValue>[] = [];
afterEach(async () => {
  await Promise.all(players.splice(0).map((player) => player.close()));
});
const limits = (overrides: ResourceLimitOverrides = {}) =>
  resolveResourceLimits({ cpuMs: 100, wallMs: 1000, ...overrides });
async function create(
  source: string,
  overrides: {
    captureLogs?: boolean;
    sdkSource?: string;
    limits?: ReturnType<typeof limits>;
    logBudget?: MatchLogBudget;
    parseAction?: SandboxOptions<JsonValue>["parseAction"];
  } = {},
) {
  const player = await SandboxPlayer.create<JsonValue>({
    source,
    matchId: "match",
    playerId: `p${players.length}`,
    isolation: { kind: "local" },
    limits: limits(),
    defaultAction: { type: "idle" },
    parseAction(action) {
      return typeof action === "object" &&
        action !== null &&
        !Array.isArray(action) &&
        action.type === "move"
        ? { ok: true, action }
        : { ok: false, message: "Expected move action" };
    },
    ...overrides,
  });
  players.push(player);
  return player;
}

test("ticks preserve only committed Memory, reset globals, use detached observations and SDK", async () => {
  const player = await create(
    `let count=0; export default ({observation,Memory,sdk}) => {
    count++; observation.value=999; Memory.n=(Memory.n??0)+count;
    return sdk.move(Memory.n);
  }`,
    { sdkSource: `export default {move(n){return {type:'move',n}}}` },
  );
  const observation = { value: 1 };
  expect((await player.execute(0, observation)).action).toEqual({ type: "move", n: 1 });
  expect((await player.execute(1, observation)).action).toEqual({ type: "move", n: 2 });
  expect(observation).toEqual({ value: 1 });
  const memory = player.memory;
  memory.n = 100;
  expect(player.memory).toEqual({ n: 2 });
});

test("runtime errors discard all candidate output, preserve captured logs, and recover next tick", async () => {
  const player = await create(
    `export default ({observation,Memory})=>{
    Memory.n=(Memory.n??0)+1; console.log('n',Memory.n);
    if(observation.fail) throw new Error('boom'); return {type:'move'};
  }`,
    { captureLogs: true },
  );
  expect((await player.execute(0, {})).ok).toBe(true);
  const failed = await player.execute(1, { fail: true });
  expect(failed).toMatchObject({
    ok: false,
    action: { type: "idle" },
    memory: { n: 1 },
    error: { type: "RUNTIME_ERROR", message: "boom" },
    logs: [{ level: "log", message: "n 2" }],
  });
  expect(await player.execute(2, {})).toMatchObject({ ok: true, memory: { n: 2 } });
});

test("invalid game actions discard otherwise valid candidate Memory", async () => {
  const player = await create(
    `export default ({observation,Memory})=>{Memory.n=1;return {type:observation.valid?'move':'wrong'}}`,
  );
  expect(await player.execute(0, {})).toMatchObject({
    ok: false,
    error: { type: "INVALID_ACTION" },
    memory: {},
  });
  expect((await player.execute(1, { valid: true })).ok).toBe(true);
});

test("the engine may supply a state-dependent fallback action for each tick", async () => {
  const player = await create(`export default ()=>({type:'invalid'})`);
  expect((await player.execute(0, {}, { type: "move", direction: "right" })).action).toEqual({
    type: "move",
    direction: "right",
  });
});

test.each([
  ["cycle", "Memory.self=Memory"],
  ["undefined", "Memory.value=undefined"],
  ["NaN", "Memory.value=NaN"],
  ["BigInt", "Memory.value=1n"],
  ["instance", "Memory.value=new Date()"],
  ["sparse", "Memory.value=new Array(2)"],
  ["function", "Memory.value=()=>1"],
  ["symbol key", "Memory[Symbol('x')]=1"],
  ["accessor", "Object.defineProperty(Memory,'value',{enumerable:true,get(){while(true){}}})"],
  [
    "accessor with prototype pollution",
    "Object.defineProperty(Memory,'value',{enumerable:true,get(){throw 0}});Object.prototype.value=1",
  ],
])(
  "rejects %s Memory without running getters or silent JSON conversion",
  async (_name, statement) => {
    const player = await create(`export default ({Memory})=>{${statement};return {type:'move'}}`);
    expect(await player.execute(0, {})).toMatchObject({
      ok: false,
      error: { type: "MEMORY_INVALID" },
      memory: {},
    });
  },
);

test("UTF-8 Memory and action budgets apply to encoded bytes", async () => {
  const player = await create(
    `export default ({observation,Memory})=>{if(observation.action)return {type:'move',text:'界'.repeat(30)};Memory.text='界'.repeat(30);return {type:'move'}}`,
    { limits: limits({ memoryBytes: 64, actionBytes: 64 }) },
  );
  expect(await player.execute(0, {})).toMatchObject({ ok: false, error: { type: "MEMORY_LIMIT" } });
  expect(await player.execute(1, { action: true })).toMatchObject({
    ok: false,
    error: { type: "INVALID_ACTION" },
  });
});

test("null-prototype objects, shared references and __proto__ keys remain safe JSON data", async () => {
  const player = await create(`export default ({Memory})=>{
    const value=Object.create(null);value.x=1;Memory.a=value;Memory.b=value;
    Object.defineProperty(Memory,'__proto__',{enumerable:true,value:{polluted:true}});
    return {type:'move'};
  }`);
  const result = await player.execute(0, {});
  expect(result.ok).toBe(true);
  expect(result.memory.a).toEqual({ x: 1 });
  expect(Object.hasOwn(result.memory, "__proto__")).toBe(true);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test("player modifications of builtins cannot replace the submission path", async () => {
  const player = await create(`export default ({Memory})=>{
    JSON.stringify=()=>'{"ok":true}';Object.getOwnPropertyDescriptor=()=>({value:0});
    Set.prototype.has=()=>false;Array.isArray=()=>false;Reflect.apply=()=>0;
    Memory.n=2;return {type:'move'};
  }`);
  expect(await player.execute(0, {})).toMatchObject({
    ok: true,
    memory: { n: 2 },
    action: { type: "move" },
  });
});

test("prototype toJSON hooks cannot forge a successful error result", async () => {
  const player = await create(`export default ({Memory})=>{
    Object.prototype.toJSON=()=>({ok:true,action:{type:'move'},memory:{forged:true}});
    Memory.bad=undefined;return {type:'move'};
  }`);
  expect(await player.execute(0, {})).toMatchObject({
    ok: false,
    error: { type: "MEMORY_INVALID" },
    memory: {},
  });
});

test("diagnostics remain within small byte budgets even with escaped control characters", async () => {
  const player = await create(
    `export default ()=>{const e=new Error(String.fromCharCode(0).repeat(10000));e.name='N'.repeat(10000);throw e}`,
    { limits: limits({ errorBytes: 128 }) },
  );
  const result = await player.execute(0, {});
  expect(result.error?.type).toBe("RUNTIME_ERROR");
  expect(Buffer.byteLength(JSON.stringify(result.error))).toBeLessThanOrEqual(128);
});

test.each([
  ["heap allocation", "try { new ArrayBuffer(8*1024*1024) } catch {}", "HEAP_LIMIT"],
  ["giant string allocation", "try { 'x'.repeat(8*1024*1024) } catch {}", "HEAP_LIMIT"],
  [
    "cumulative allocations",
    "try { const a=[];for(let i=0;i<64;i++)a.push(new ArrayBuffer(128*1024)); } catch {}",
    "HEAP_LIMIT",
  ],
  ["stack overflow", "try { function recur(){return recur()} recur(); } catch {}", "STACK_LIMIT"],
  ["CPU interrupt", "try { while(true){} } catch {}", "CPU_LIMIT"],
])("%s cannot be hidden with catch and recovers next tick", async (_name, body, type) => {
  const player = await create(
    `export default ({observation,Memory})=>{Memory.n=1;if(observation.fail){${body}};return {type:'move'}}`,
    { limits: limits({ heapBytes: 2 * 1024 * 1024, cpuMs: 40 }) },
  );
  expect(await player.execute(0, { fail: true })).toMatchObject({
    ok: false,
    error: { type },
    memory: {},
  });
  expect(await player.execute(1, {})).toMatchObject({ ok: true, memory: { n: 1 } });
});

test("one failing player cannot block another player's process", async () => {
  const a = await create(`export default ()=>{while(true){}}`, { limits: limits({ cpuMs: 30 }) });
  const b = await create(`export default ()=>({type:'move'})`);
  expect(a.processId).not.toBe(b.processId);
  const [failure, success] = await Promise.all([a.execute(0, {}), b.execute(0, {})]);
  expect(failure.error?.type).toBe("CPU_LIMIT");
  expect(success.ok).toBe(true);
});

test("top-level work and serialization count toward the CPU budget", async () => {
  const player = await create(`while(true){};export default ()=>({type:'move'})`, {
    limits: limits({ cpuMs: 25 }),
  });
  const output = await player.execute(0, {});
  expect(output.error?.type).toBe("CPU_LIMIT");
  expect(output.resources?.cpuUsedUs).toBeGreaterThanOrEqual(25000);
});

test("promise results are rejected and queued jobs are never drained", async () => {
  const asyncPlayer = await create(`export default async ()=>({type:'move'})`);
  expect((await asyncPlayer.execute(0, {})).error?.type).toBe("ENTRYPOINT_ERROR");
  const player = await create(
    `export default ({Memory})=>{Promise.resolve().then(()=>{Memory.n=10;while(true){}});Memory.n=1;return {type:'move'}}`,
  );
  expect(await player.execute(0, {})).toMatchObject({ ok: true, memory: { n: 1 } });
});

test("no Node, network, timers or host object references are exposed", async () => {
  const player = await create(`export default ({Memory})=>{
    Memory.types=[typeof process,typeof require,typeof fetch,typeof setTimeout,typeof Buffer,typeof WebAssembly];
    Memory.constructorRealm=console.log.constructor('return typeof process')();
    return {type:'move'};
  }`);
  const result = await player.execute(0, {});
  expect(result).toMatchObject({
    ok: true,
    memory: { types: Array(6).fill("undefined"), constructorRealm: "undefined" },
  });
});

test("logs are snapshots, bounded, ordered, and retained before CPU interruption", async () => {
  const player = await create(
    `export default ()=>{const x={n:1};console.info(x);x.n=2;console.warn('next');for(let i=0;i<20;i++)console.log('你好'.repeat(50));while(true){}}`,
    {
      captureLogs: true,
      limits: limits({
        cpuMs: 40,
        logs: { lineBytes: 32, tickBytes: 80, tickLines: 4, matchBytes: 128 },
      }),
    },
  );
  const result = await player.execute(0, {});
  expect(result.error?.type).toBe("CPU_LIMIT");
  expect(result.logsTruncated).toBe(true);
  expect(result.logs?.slice(0, 2)).toEqual([
    { level: "info", message: '{"n":1}' },
    { level: "warn", message: "next" },
  ]);
  expect(result.logs!.length).toBeLessThanOrEqual(4);
  expect(result.logs!.every((log) => Buffer.byteLength(log.message) <= 32)).toBe(true);
  expect(
    result.logs!.reduce((sum, log) => sum + Buffer.byteLength(log.message), 0),
  ).toBeLessThanOrEqual(80);
});

test("local log limits truncate without invalidating a successful action", async () => {
  const budget = new MatchLogBudget(40);
  const a = await create(
    `export default ()=>{for(let i=0;i<20;i++)console.log('0123456789');return {type:'move'}}`,
    {
      captureLogs: true,
      logBudget: budget,
      limits: limits({ logs: { lineBytes: 16, tickBytes: 32, matchBytes: 40 } }),
    },
  );
  const b = await create(`export default ()=>{console.log('abcdefghij');return {type:'move'}}`, {
    captureLogs: true,
    logBudget: budget,
    limits: limits({ logs: { lineBytes: 16, tickBytes: 32, matchBytes: 40 } }),
  });
  const first = await a.execute(0, {}),
    second = await b.execute(0, {}),
    third = await b.execute(1, {});
  expect(first).toMatchObject({ ok: true, logsTruncated: true });
  expect(second.ok).toBe(true);
  expect(third).toMatchObject({ ok: true, logs: [], logsTruncated: true });
  expect(budget.remainingBytes).toBe(0);
});

test("server console never formats arguments", async () => {
  const player = await create(
    `export default ()=>{console.log(new Proxy({}, {ownKeys(){while(true){}}}));return {type:'move'}}`,
  );
  const result = await player.execute(0, {});
  expect(result.ok).toBe(true);
  expect(result).not.toHaveProperty("logs");
  expect(result).not.toHaveProperty("logsTruncated");
});

test("throw objects with hostile getters yield a bounded diagnostic", async () => {
  const player = await create(
    `export default ()=>{throw {get message(){while(true){}},get stack(){throw 1}}}`,
  );
  expect(await player.execute(0, {})).toMatchObject({
    ok: false,
    error: { type: "RUNTIME_ERROR", message: "Player execution failed" },
  });
});

test("killed executors return an error, rebuild with a new generation, and retain Memory", async () => {
  const player = await create(
    `export default ({Memory})=>{Memory.n=(Memory.n??0)+1;return {type:'move'}}`,
  );
  const before = await player.execute(0, {});
  process.kill(player.processId!, "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const failed = await player.execute(1, {});
  expect(failed).toMatchObject({ ok: false, memory: { n: 1 }, error: { type: "EXECUTOR_ERROR" } });
  const recovered = await player.execute(2, {});
  expect(recovered).toMatchObject({ ok: true, memory: { n: 2 } });
  expect(recovered.executionId).not.toBe(before.executionId);
});

test("a transient rebuild failure is retried on later ticks instead of wedging the player", async () => {
  const player = await create(
    `export default ({Memory})=>{Memory.n=(Memory.n??0)+1;return {type:'move'}}`,
  );
  await player.execute(0, {});
  process.kill(player.processId!, "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const start = vi
    .spyOn(ExecutorProcess, "start")
    .mockRejectedValueOnce(new Error("simulated EMFILE"));
  const failedTick = await player.execute(1, {});
  expect(failedTick).toMatchObject({ ok: false, error: { type: "EXECUTOR_ERROR" } });
  // The rebuild closes the dead process before spawning; wait for the mocked
  // failure to settle so rebuildError is set before the next tick.
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  // The failed rebuild must not become a permanent system error: the next tick
  // triggers a fresh attempt (real start restored) and play continues.
  const retrying = await player.execute(2, {});
  expect(retrying).toMatchObject({ ok: false, error: { type: "EXECUTOR_ERROR" } });
  const recovered = await player.execute(3, {});
  expect(recovered).toMatchObject({ ok: true, memory: { n: 2 } });
});

test("wall watchdog kills a delayed executor and allows later ticks to recover", async () => {
  const budget = limits({ cpuMs: 40, wallMs: 80 });
  const player = await create(
    `export default ({Memory})=>{Memory.n=(Memory.n??0)+1;return {type:'move'}}`,
    { limits: budget },
  );
  await player.execute(0, {});
  const pid = player.processId!;
  process.kill(pid, "SIGSTOP");
  const output = await player.execute(1, {});
  expect(output).toMatchObject({
    ok: false,
    error: { type: "EXECUTION_TIMEOUT" },
    memory: { n: 1 },
  });
  // Rebuilding is asynchronous and has its own startup budget, independent of this 80ms tick.
  await expect.poll(() => player.processId, { timeout: budget.startupMs }).toBeDefined();
  expect(player.processId).not.toBe(pid);
  expect(await player.execute(2, {})).toMatchObject({ ok: true, memory: { n: 2 } });
}, 10000);

test("platform input and trusted parser failures are system errors", async () => {
  const player = await create(`export default ()=>({type:'move'})`, {
    limits: limits({ observationBytes: 16 }),
  });
  await expect(player.execute(0, { text: "x".repeat(30) })).rejects.toBeInstanceOf(
    SandboxSystemError,
  );
  expect((await player.execute(0, {})).ok).toBe(true);
  const broken = await create(`export default ({Memory})=>{Memory.n=1;return {type:'move'}}`, {
    parseAction() {
      throw new SandboxSystemError("Broken trusted game parser");
    },
  });
  await expect(broken.execute(0, {})).rejects.toThrow("Broken trusted game parser");
  expect(broken.memory).toEqual({});
  const brokenSdk = await create(`export default ()=>({type:'move'})`, {
    sdkSource: "throw new Error('SDK initialization failed');export default {}",
  });
  await expect(brokenSdk.execute(0, {})).rejects.toBeInstanceOf(SandboxSystemError);
});

test("expensive native regex work is bounded and the following tick can recover", async () => {
  const player = await create(
    `export default ({observation})=>{if(observation.fail) /^(a+)+$/.test('a'.repeat(40)+'b');return {type:'move'}}`,
    { limits: limits({ cpuMs: 30, wallMs: 300 }) },
  );
  const output = await player.execute(0, { fail: true });
  expect(output.ok).toBe(false);
  expect(["CPU_LIMIT", "EXECUTION_TIMEOUT"]).toContain(output.error?.type);
  expect((await player.execute(1, {})).ok).toBe(true);
});

test("duplicate ticks, concurrent requests and closed players are rejected", async () => {
  const player = await create(`export default ()=>({type:'move'})`);
  const pending = player.execute(0, {});
  await expect(player.execute(1, {})).rejects.toThrow("Concurrent");
  await pending;
  await expect(player.execute(0, {})).rejects.toThrow("increasing");
  await player.close();
  await expect(player.execute(2, {})).rejects.toThrow("closed");
});

test.each([
  "import x from 'node:fs';export default ()=>x",
  "export * from 'x'",
  "export {x} from 'x'",
  "export default ()=>import('x')",
  "await Promise.resolve();export default ()=>1",
  "function broken( {",
])("isolated syntax validation rejects unsupported source: %s", async (source) => {
  expect(
    await validateSource({ source, limits: limits(), isolation: { kind: "local" } }),
  ).toMatchObject({ ok: false, error: { type: "ENTRYPOINT_ERROR" } });
});

test("compile-only validation never evaluates top-level player code", async () => {
  expect(
    await validateSource({
      source: "while(true){};export default ()=>1",
      limits: limits(),
      isolation: { kind: "local" },
    }),
  ).toEqual({ ok: true });
});

test("oversized source is rejected before creating an executor", async () => {
  await expect(create("x".repeat(1025), { limits: limits({ codeBytes: 1024 }) })).rejects.toThrow(
    "source",
  );
});

// The first tick rides its budget closely, so a busy parallel test run can
// inflate measured CPU; a real regression (per-tick billed Acorn) fails every
// attempt, while load spikes do not survive a retry.
test("large valid sources stay playable within the default CPU budget", { retry: 2 }, async () => {
  // ~64KiB of statements: with the static check unbilled, tick 0 costs setup
  // plus compile (~26ms measured here); when the check was billed inside the
  // window, the ~26ms Acorn parse put tick 0 near 52ms and the source could
  // never play. The threshold sits between with headroom on both sides.
  const filler = Array.from({ length: 3000 }, (_, i) => `const filler${i}=${i};`).join("");
  const player = await create(`${filler}export default ()=>({type:'move'})`, {
    // Wall time is not the property under test; a generous wall budget keeps a
    // busy parallel test run from turning spawn latency into a failure.
    limits: limits({ cpuMs: 100, wallMs: 2000 }),
  });
  const first = await player.execute(0, {});
  expect(first.ok).toBe(true);
  expect(first.resources?.cpuUsedUs).toBeLessThan(45_000);
  expect((await player.execute(1, {})).ok).toBe(true);
});

test("steady-state ticks do not pay for static source checks", { retry: 2 }, async () => {
  // Re-parsing ~64KiB with Acorn on every tick kept steady-state CPU around 34ms;
  // the QuickJS compile alone runs near 9ms, well under the 20ms assertion. The
  // retry absorbs CPU-time inflation from a busy parallel test run.
  const filler = Array.from({ length: 3000 }, (_, i) => `const filler${i}=${i};`).join("");
  const player = await create(`${filler}export default ()=>({type:'move'})`, {
    limits: limits({ cpuMs: 100, wallMs: 1000 }),
  });
  expect((await player.execute(0, {})).ok).toBe(true);
  const steady = await player.execute(1, {});
  expect(steady.ok).toBe(true);
  expect(steady.resources?.cpuUsedUs).toBeLessThan(20_000);
});

test(
  "large valid sources pass isolated validation under production budgets",
  { retry: 2 },
  async () => {
    // ~31KiB parses for ~13ms with Acorn; when the static check was billed inside
    // the validation window, valid sources of this size were rejected as CPU_LIMIT.
    const filler = Array.from({ length: 1500 }, (_, i) => `const filler${i}=${i};`).join("");
    expect(
      await validateSource({
        source: `${filler}export default ()=>({type:'move'})`,
        limits: limits({ cpuMs: 20, wallMs: 500 }),
        isolation: { kind: "local" },
      }),
    ).toEqual({ ok: true });
  },
);

test("sources rejected by the static check still fail the first tick as ENTRYPOINT_ERROR", async () => {
  const player = await create(`import x from 'x';export default ()=>({type:'move'})`);
  expect(await player.execute(0, {})).toMatchObject({
    ok: false,
    action: { type: "idle" },
    error: { type: "ENTRYPOINT_ERROR" },
  });
});
