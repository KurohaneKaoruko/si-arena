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
    defaultAction?: JsonValue;
  } = {},
) {
  const player = await SandboxPlayer.create<JsonValue>({
    source,
    matchId: "match",
    playerId: `p${players.length}`,
    isolation: { kind: "local" },
    limits: limits(),
    sdkSource: `export default (o,{submit})=>{submit({type:"move"});return {...o,submit}}`,
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

// The CPU thresholds in the performance tests below were calibrated on a fast
// reference core; shared CI runners execute the same guest work 2-3x slower.
// Measure this machine's steady guest speed with a spin of the reference size
// and scale budgets and thresholds by the same factor, keeping the regression
// signal (roughly a 2x cost step) detectable on any hardware. The calibration
// workload must dwarf the thread CPU accounting granularity: billed cpuUsedUs
// covers only guest work (~120us for a trivial tick), and Linux reports thread
// CPU in scheduler ticks (1-4ms), so a tiny calibration reads as zero there.
async function cpuSpeedFactor(): Promise<number> {
  const player = await create(
    "export default ({game,Memory})=>{let s=0;for(let i=0;i<200000;i++)s+=i;return game.submit({type:'move'})}",
    {
      limits: limits({ cpuMs: 1000, wallMs: 10000 }),
    },
  );
  try {
    // The first tick pays one-time JIT warm-up; the second reflects steady cost.
    await player.execute(0, {});
    const steady = await player.execute(1, {});
    const baseline = steady.resources?.cpuUsedUs ?? 0;
    if (!steady.ok || baseline <= 0) throw new Error("CPU speed calibration failed");
    return Math.max(1, baseline / 10_000);
  } finally {
    await player.close();
  }
}

test("successful ticks retain globals and SDK state with detached observations and Memory", async () => {
  const player = await create(
    "let count=0; export default ({game,Memory}) => {\n    count++; game.value=999; Memory.n=(Memory.n??0)+count;\n    return game.move(Memory.n);\n  }",
    {
      sdkSource: `export default (o,{submit})=>{submit({type:'move'});return {...o,submit,move(n){submit({type:'move',n})}}}`,
    },
  );
  const observation = { value: 1 };
  expect((await player.execute(0, observation)).action).toEqual({ type: "move", n: 1 });
  expect((await player.execute(1, observation)).action).toEqual({ type: "move", n: 3 });
  expect(observation).toEqual({ value: 1 });
  const memory = player.memory;
  memory.n = 100;
  expect(player.memory).toEqual({ n: 3 });
});

test("a game may collect multiple actors and arbitrary commands without platform movement concepts", async () => {
  const player = await create(
    `export default ({game,Memory})=>{
    Memory.n=(Memory.n??0)+1;
    if(game.tick===0){game.units[0].gather('ore');game.units[0].gather('wood');game.units[1].attack('enemy')}
    if(game.fail)throw new Error('rollback all orders');
  }`,
    {
      defaultAction: [],
      parseAction: (action) => ({ ok: true, action }),
      sdkSource: `const freeze=Object.freeze;export default (o,{submit})=>{
      const orders=[];submit(orders);
      return freeze({...o,units:freeze([
        freeze({gather(target){orders[0]={actor:'worker',kind:'gather',target}}}),
        freeze({attack(target){orders[1]={actor:'soldier',kind:'attack',target}}})
      ])});
    }`,
    },
  );
  expect(await player.execute(0, { tick: 0 })).toMatchObject({
    ok: true,
    action: [
      { actor: "worker", kind: "gather", target: "wood" },
      { actor: "soldier", kind: "attack", target: "enemy" },
    ],
    memory: { n: 1 },
  });
  expect(await player.execute(1, { tick: 1 })).toMatchObject({
    ok: true,
    action: [],
    memory: { n: 2 },
  });
  expect(await player.execute(2, { tick: 0, fail: true })).toMatchObject({
    ok: false,
    action: [],
    memory: { n: 2 },
  });
  expect(await player.execute(3, { tick: 1 })).toMatchObject({
    ok: true,
    action: [],
    memory: { n: 3 },
  });
});

test("retained commands cannot submit into another tick even when their error is caught", async () => {
  const player = await create(`let old;export default ({game,Memory})=>{
    Memory.n=(Memory.n??0)+1;
    if(game.tick===1){try{old({type:'move',stale:true})}catch{}}
    game.submit({type:'move'});old=game.submit;
  }`);
  expect(await player.execute(0, { tick: 0 })).toMatchObject({ ok: true, memory: { n: 1 } });
  expect(await player.execute(1, { tick: 1 })).toMatchObject({
    ok: false,
    error: { type: "INVALID_ACTION" },
    memory: { n: 1 },
  });
  expect(await player.execute(2, { tick: 2 })).toMatchObject({ ok: true, memory: { n: 2 } });
});

test.each(["({type:'move'})", "null", "Promise.resolve()"])(
  "returning %s cannot override commands and rolls back Memory",
  async (value) => {
    const player = await create(
      `export default ({game,Memory})=>{Memory.n=1;game.submit({type:'move'});return ${value}}`,
    );
    expect(await player.execute(0, {})).toMatchObject({
      ok: false,
      error: { type: "ENTRYPOINT_ERROR" },
      memory: {},
      action: { type: "idle" },
    });
  },
);

test("invalid game commands remain failed after a catch and a later valid command", async () => {
  const player = await create(
    `export default ({game,Memory})=>{Memory.n=1;try{game.invalid()}catch{}game.valid()}`,
    {
      sdkSource: `export default (o,{submit,reject})=>{submit({type:'move'});return {invalid(){reject('Invalid target')},valid(){submit({type:'move'})}}}`,
    },
  );
  expect(await player.execute(0, {})).toMatchObject({
    ok: false,
    error: { type: "INVALID_ACTION" },
    memory: {},
  });
});

test("trusted game API factory failures remain system errors", async () => {
  for (const sdkSource of [
    `export default ()=>{throw new Error('broken factory')}`,
    `export default ()=>({})`,
    `export default {}`,
    `export default (o,{submit})=>{submit(undefined);return {...o}}`,
    `export default (o,{submit})=>{submit(()=>{});return {...o}}`,
  ]) {
    const player = await create(`export default ()=>{}`, { sdkSource });
    await expect(player.execute(0, {})).rejects.toBeInstanceOf(SandboxSystemError);
    expect(player.memory).toEqual({});
  }
});

test("a missing trusted SDK source fails fast instead of deep in the executor", async () => {
  await expect(
    SandboxPlayer.create<JsonValue>({
      source: "export default ()=>{}",
      matchId: "match",
      playerId: "p",
      isolation: { kind: "local" },
      limits: limits(),
      sdkSource: undefined as unknown as string,
      defaultAction: { type: "idle" },
      parseAction: () => ({ ok: true, action: { type: "idle" } }),
    }),
  ).rejects.toThrow(TypeError);
});

test("runtime errors discard all candidate output, preserve captured logs, and recover next tick", async () => {
  const player = await create(
    "export default ({game,Memory})=>{\n    Memory.n=(Memory.n??0)+1; console.log('n',Memory.n);\n    if(game.fail) throw new Error('boom'); return game.submit({type:'move'});\n  }",
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

test("module initialization and SDK caches run once, while inputs and log budgets refresh each tick", async () => {
  const player = await create(
    "console.log('init');let previous;let calls=0;\n    export default ({game,Memory})=>{\n      calls++;console.log('tick',game.tick);\n      Memory.last=previous?.tick??-1;Memory.calls=calls;Memory.sdk=game.next();\n      previous=game;return game.submit({type:'move'});\n    }",
    {
      captureLogs: true,
      sdkSource: `let calls=0;export default (o,{submit})=>{submit({type:'move'});return {...o,submit,next(){return ++calls}}}`,
      limits: limits({ logs: { tickLines: 2 } }),
    },
  );
  expect(await player.execute(0, { tick: 0 })).toMatchObject({
    ok: true,
    memory: { last: -1, calls: 1, sdk: 1 },
    logs: [{ message: "init" }, { message: "tick 0" }],
  });
  expect(await player.execute(1, { tick: 1 })).toMatchObject({
    ok: true,
    memory: { last: 0, calls: 2, sdk: 2 },
    logs: [{ message: "tick 1" }],
  });
  const other = await create(
    "let calls=0;export default ({game,Memory})=>{game.submit(({type:'move',n:++calls}));}",
  );
  expect((await other.execute(0, {})).action).toEqual({ type: "move", n: 1 });
});

test.each([
  ["throw", "throw new Error('failed')", "RUNTIME_ERROR"],
  ["game action", "game.submit({type:'wrong'});return", "INVALID_ACTION"],
  ["Memory", "Memory.invalid=undefined", "MEMORY_INVALID"],
  ["CPU", "while(true){}", "CPU_LIMIT"],
  ["heap", "new ArrayBuffer(16*1024*1024)", "HEAP_LIMIT"],
  ["stack", "function f(){return f()}f()", "STACK_LIMIT"],
])(
  "%s failure discards all volatile state and restores only the last Memory checkpoint",
  async (_label, body, type) => {
    const player = await create(
      `let calls=0;export default ({game,Memory})=>{
    calls++;const cached=game.next();Memory.n=(Memory.n??0)+1;
    if(game.fail){${body}}return game.submit({type:'move',calls,cached});
  }`,
      {
        sdkSource: `let calls=0;export default (o,{submit})=>{submit({type:'move'});return {...o,submit,next(){return ++calls}}}`,
        limits: limits({ cpuMs: 40, heapBytes: 2 * 1024 * 1024 }),
      },
    );
    expect(await player.execute(0, {})).toMatchObject({ ok: true, memory: { n: 1 } });
    const pid = player.processId;
    expect(await player.execute(1, { fail: true })).toMatchObject({
      ok: false,
      error: { type },
      memory: { n: 1 },
    });
    expect(await player.execute(2, {})).toMatchObject({
      ok: true,
      action: { type: "move", calls: 1, cached: 1 },
      memory: { n: 2 },
    });
    expect(player.processId).toBe(pid);
  },
);

test("captured input parsing and serialization stay trusted after cross-tick builtin pollution", async () => {
  const player = await create(
    "export default ({game,Memory})=>{\n    Memory.n=(Memory.n??0)+1;Memory.observed=game.tick;\n    JSON.parse=()=>({memory:{forged:true}});JSON.stringify=()=>'{\"ok\":true}';\n    Object.prototype.toJSON=()=>({forged:true});\n    Object.getOwnPropertyDescriptor=()=>({value:0});Reflect.apply=()=>0;\n    String.prototype.charCodeAt=()=>0;Set.prototype.has=()=>false;\n    return game.submit({type:'move'});\n  }",
  );
  expect(await player.execute(0, { tick: 0 })).toMatchObject({
    ok: true,
    memory: { n: 1, observed: 0 },
  });
  expect(await player.execute(1, { tick: 1 })).toMatchObject({
    ok: true,
    memory: { n: 2, observed: 1 },
  });
});

test("fresh nested JSON freezes without invoking polluted prototypes during trusted setup", async () => {
  const player = await create(`export default ({game,Memory})=>{
    Memory.value=game.nested.items[0].x;
    Memory.frozen=Object.isFrozen(game.nested)&&Object.isFrozen(game.nested.items)&&Object.isFrozen(game.nested.items[0]);
    Object.defineProperty(Object.prototype,'x',{configurable:true,get(){while(true){}}});
    Object.defineProperty(Array.prototype,'0',{configurable:true,get(){while(true){}}});
    game.submit({type:'move'});
  }`);
  for (let tick = 0; tick < 2; tick++)
    expect(await player.execute(tick, { nested: { items: [{ x: tick }] } })).toMatchObject({
      ok: true,
      memory: { value: tick, frozen: true },
    });
});

test("retained player heaps remain bounded across ticks and recover after exhaustion", async () => {
  const player = await create(
    "const cache=[];export default ({game,Memory})=>{\n    if(!game.recover)cache.push(new ArrayBuffer(256*1024));\n    Memory.n=(Memory.n??0)+1;return game.submit({type:'move',cached:cache.length});\n  }",
    { limits: limits({ heapBytes: 2 * 1024 * 1024 }) },
  );
  let committed = 0;
  let failed = false;
  // The isolate floor is 8MiB, so the retained buffers need about 32 ticks.
  for (let tick = 0; tick < 64; tick++) {
    const result = await player.execute(tick, {});
    if (!result.ok) {
      expect(result.error?.type).toBe("HEAP_LIMIT");
      expect(result.memory).toEqual({ n: committed });
      expect(await player.execute(tick + 1, { recover: true })).toMatchObject({
        ok: true,
        action: { type: "move", cached: 0 },
        memory: { n: committed + 1 },
      });
      failed = true;
      break;
    }
    committed++;
  }
  expect(failed).toBe(true);
});

test("a retained cache exhausting the next input allocation is a player heap failure", async () => {
  const player = await create(
    "const cache=[];for(let i=0;i<40000;i++)cache.push({i,x:[i,i+1],t:'abc'});\n    export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;return game.submit({type:'move',cached:cache.length})}",
    {
      limits: limits({
        heapBytes: 8 * 1024 * 1024,
        observationBytes: 4 * 1024 * 1024,
        ipcBytes: 8 * 1024 * 1024,
      }),
    },
  );
  expect(await player.execute(0, {})).toMatchObject({ ok: true, memory: { n: 1 } });
  const items = Array.from({ length: 60000 }, (_, i) => ({ i, x: [i, i + 1], t: "abc" }));
  expect(await player.execute(1, { items })).toMatchObject({
    ok: false,
    error: { type: "HEAP_LIMIT" },
    memory: { n: 1 },
  });
  expect(await player.execute(2, {})).toMatchObject({ ok: true, memory: { n: 2 } });
});

test("invalid game actions discard otherwise valid candidate Memory", async () => {
  const player = await create(
    "export default ({game,Memory})=>{Memory.n=1;return game.submit({type:game.valid?'move':'wrong'})}",
  );
  expect(await player.execute(0, {})).toMatchObject({
    ok: false,
    error: { type: "INVALID_ACTION" },
    memory: {},
  });
  expect((await player.execute(1, { valid: true })).ok).toBe(true);
});

test("the engine may supply a state-dependent fallback action for each tick", async () => {
  const player = await create("export default ({game,Memory})=>{game.submit(({type:'invalid'}));}");
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
    const player = await create(
      `export default ({game,Memory})=>{${statement};return game.submit({type:'move'})}`,
    );
    expect(await player.execute(0, {})).toMatchObject({
      ok: false,
      error: { type: "MEMORY_INVALID" },
      memory: {},
    });
  },
);

test("UTF-8 Memory and action budgets apply to encoded bytes", async () => {
  const player = await create(
    "export default ({game,Memory})=>{if(game.action)return game.submit({type:'move',text:'界'.repeat(30)});Memory.text='界'.repeat(30);return game.submit({type:'move'})}",
    { limits: limits({ memoryBytes: 64, actionBytes: 64 }) },
  );
  expect(await player.execute(0, {})).toMatchObject({ ok: false, error: { type: "MEMORY_LIMIT" } });
  expect(await player.execute(1, { action: true })).toMatchObject({
    ok: false,
    error: { type: "INVALID_ACTION" },
  });
});

test.each(["ASCII", "你好", "🌟", "\ud800", "\udc00", '\u0000\n"\\'])(
  "captured character access preserves exact Memory limits across ticks for %s",
  async (text) => {
    const bytes = Buffer.byteLength(JSON.stringify({ text }));
    const source =
      "export default ({game,Memory})=>{Memory.text=game.text;\n      String.prototype.charCodeAt=()=>0;Function.prototype.call=()=>0;Function.prototype.bind=()=>0;\n      return game.submit({type:'move'})}";
    const player = await create(source, { limits: limits({ memoryBytes: bytes }) });
    expect(await player.execute(0, { text })).toMatchObject({ ok: true, memory: { text } });
    expect(await player.execute(1, { text })).toMatchObject({ ok: true, memory: { text } });
    const tooSmall = await create(source, { limits: limits({ memoryBytes: bytes - 1 }) });
    expect(await tooSmall.execute(0, { text })).toMatchObject({
      ok: false,
      error: { type: "MEMORY_LIMIT" },
      memory: {},
    });
  },
);

test("null-prototype objects, shared references and __proto__ keys remain safe JSON data", async () => {
  const player = await create(
    "export default ({game,Memory})=>{\n    const value=Object.create(null);value.x=1;Memory.a=value;Memory.b=value;\n    Object.defineProperty(Memory,'__proto__',{enumerable:true,value:{polluted:true}});\n    return game.submit({type:'move'});\n  }",
  );
  const result = await player.execute(0, {});
  expect(result.ok).toBe(true);
  expect(result.memory.a).toEqual({ x: 1 });
  expect(Object.hasOwn(result.memory, "__proto__")).toBe(true);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test("player modifications of builtins cannot replace the submission path", async () => {
  const player = await create(
    "export default ({game,Memory})=>{\n    JSON.stringify=()=>'{\"ok\":true}';Object.getOwnPropertyDescriptor=()=>({value:0});\n    Set.prototype.has=()=>false;Array.isArray=()=>false;Reflect.apply=()=>0;\n    Memory.n=2;return game.submit({type:'move'});\n  }",
  );
  expect(await player.execute(0, {})).toMatchObject({
    ok: true,
    memory: { n: 2 },
    action: { type: "move" },
  });
});

test("prototype toJSON hooks cannot forge a successful error result", async () => {
  const player = await create(
    "export default ({game,Memory})=>{\n    Object.prototype.toJSON=()=>({ok:true,action:{type:'move'},memory:{forged:true}});\n    Memory.bad=undefined;return game.submit({type:'move'});\n  }",
  );
  expect(await player.execute(0, {})).toMatchObject({
    ok: false,
    error: { type: "MEMORY_INVALID" },
    memory: {},
  });
});

test("diagnostics remain within small byte budgets even with escaped control characters", async () => {
  const player = await create(
    "export default ({game,Memory})=>{const e=new Error(String.fromCharCode(0).repeat(10000));e.name='N'.repeat(10000);throw e}",
    { limits: limits({ errorBytes: 128 }) },
  );
  const result = await player.execute(0, {});
  expect(result.error?.type).toBe("RUNTIME_ERROR");
  expect(Buffer.byteLength(JSON.stringify(result.error))).toBeLessThanOrEqual(128);
});

test.each([
  ["heap allocation", "new ArrayBuffer(16*1024*1024)", "HEAP_LIMIT"],
  ["cumulative allocations", "const a=[];for(;;)a.push(new Array(1e5).fill(1))", "HEAP_LIMIT"],
  ["stack overflow", "function recur(){return recur()} recur()", "STACK_LIMIT"],
  ["CPU interrupt", "try { while(true){} } catch {}", "CPU_LIMIT"],
])("uncaught %s fails under its budget type and recovers next tick", async (_name, body, type) => {
  const player = await create(
    `export default ({game,Memory})=>{Memory.n=1;if(game.fail){${body}};return game.submit({type:'move'})}`,
    { limits: limits({ heapBytes: 2 * 1024 * 1024, cpuMs: 40 }) },
  );
  expect(await player.execute(0, { fail: true })).toMatchObject({
    ok: false,
    error: { type },
    memory: {},
  });
  expect(await player.execute(1, {})).toMatchObject({ ok: true, memory: { n: 1 } });
});

test("a refused allocation or stack overflow caught by the player is ordinary JS", async () => {
  // V8 refuses the allocation outright, so the limit held; nothing is latched.
  const player = await create(
    "export default ({game,Memory})=>{try{new ArrayBuffer(16*1024*1024)}catch(e){Memory.heap=e.name};\n    try{(function f(){f()})()}catch(e){Memory.stack=e.name};return game.submit({type:'move'})}",
    { limits: limits({ heapBytes: 2 * 1024 * 1024 }) },
  );
  expect(await player.execute(0, {})).toMatchObject({
    ok: true,
    memory: { heap: "RangeError", stack: "RangeError" },
  });
});

test("recursion depth is bounded by the isolate thread regardless of stackBytes", async () => {
  // isolated-vm runs guest calls on its own threads whose stack V8 sizes itself;
  // --stack-size does not reach them, so the release stackBytes is informational.
  const source =
    "export default ({game,Memory})=>{let d=0;try{(function f(){d++;f()})()}catch{};Memory.depth=d;return game.submit({type:'move'})}";
  const small = await create(source, { limits: limits({ stackBytes: 128 * 1024 }) });
  const large = await create(source, { limits: limits({ stackBytes: 512 * 1024 }) });
  const shallow = Number((await small.execute(0, {})).memory.depth);
  const deep = Number((await large.execute(0, {})).memory.depth);
  expect(shallow).toBeGreaterThan(1000);
  expect(shallow).toBeLessThan(100000);
  expect(deep).toBe(shallow);
});

test("Function-constructor and indirect-eval import escapes load no modules and keep the executor alive", async () => {
  const player = await create(
    "let settled = 0, rejected = 0;\n    const attempts = [];\n    const attempt = (label, run) => {\n      try {\n        const value = run();\n        attempts.push(label + ':' + typeof value);\n        if (value && typeof value.then === 'function')\n          value.then(() => { settled++; }, () => { rejected++; });\n      } catch (error) {\n        attempts.push(label + ':threw:' + (error && error.message ? error.message : String(error)));\n      }\n    };\n    attempt('newFunction-node', () => new Function('return import(\"node:fs\")')());\n    attempt('newFunction-remote', () => new Function('return import(\"https://example.invalid/x.js\")')());\n    attempt('newFunction-argument', () => new Function('m', 'return import(m)')('node:fs'));\n    attempt('indirectEval-node', () => (0, eval)('import(\"node:fs\")'));\n    attempt('indirectEval-declaration', () => (0, eval)('import x from \"node:fs\"'));\n    const realm = new Function('return this')();\n    export default ({game,Memory}) => {\n      Memory.attempts = attempts;\n      Memory.settled = settled;\n      Memory.rejected = rejected;\n      Memory.hostGlobals = [typeof process, typeof require, typeof global,\n        typeof realm.process, typeof realm.require, typeof realm.global, typeof realm.fetch];\n      return game.submit({type:'move'});\n    }",
  );
  const pid = player.processId;
  const result = await player.execute(0, {});
  expect(result.ok).toBe(true);
  expect(result.action).toEqual({ type: "move" });
  const hostGlobals = result.memory.hostGlobals as string[];
  expect(hostGlobals.every((value) => value === "undefined")).toBe(true);
  // Every escape either throws a guest-catchable error or returns a promise
  // that the disabled module loader rejects at the next microtask checkpoint:
  // no fulfilment ever runs and no module is ever delivered.
  expect(result.memory.settled).toBe(0);
  const attempts = result.memory.attempts as string[];
  for (const entry of attempts)
    expect(entry).toMatch(/^(newFunction|indirectEval)-[^:]+:(object|threw:)/);
  expect(attempts.some((entry) => entry.includes("threw"))).toBe(true);
  expect(player.processId).toBe(pid);
  const promised = attempts.filter((entry) => entry.endsWith(":object")).length;
  expect(await player.execute(1, {})).toMatchObject({
    ok: true,
    memory: { settled: 0, rejected: promised },
  });
});

test("one failing player cannot block another player's process", async () => {
  const a = await create("export default ({game,Memory})=>{while(true){}}", {
    limits: limits({ cpuMs: 30 }),
  });
  const b = await create("export default ({game,Memory})=>{game.submit(({type:'move'}));}");
  expect(a.processId).not.toBe(b.processId);
  const [failure, success] = await Promise.all([a.execute(0, {}), b.execute(0, {})]);
  expect(failure.error?.type).toBe("CPU_LIMIT");
  expect(success.ok).toBe(true);
});

test("top-level work and serialization count toward the CPU budget", async () => {
  const player = await create(
    "while(true){};export default ({game,Memory})=>{game.submit(({type:'move'}));}",
    {
      limits: limits({ cpuMs: 25 }),
    },
  );
  const output = await player.execute(0, {});
  expect(output.error?.type).toBe("CPU_LIMIT");
  expect(output.resources?.cpuUsedUs).toBeGreaterThanOrEqual(25000);
});

test("trusted setup is not billed against the player CPU budget", { retry: 2 }, async () => {
  // Reporting must follow billing: the runtime, context, bootstrap and SDK
  // setup must never appear in cpuUsedUs. Both probes pay the same platform
  // setup and differ only in guest work, so whole-tick reporting would add
  // roughly the same setup to both and pull the ratio towards 1, while the
  // billed values keep the light tick far below the spin.
  const light = await create("export default ({game,Memory})=>{game.submit(({type:'move'}));}", {
    limits: limits({ cpuMs: 1000, wallMs: 10000 }),
  });
  const spin = await create(
    "export default ({game,Memory})=>{let s=0;for(let i=0;i<120000;i++)s+=i;return game.submit({type:'move'})}",
    { limits: limits({ cpuMs: 1000, wallMs: 10000 }) },
  );
  await light.execute(0, {});
  await spin.execute(0, {});
  const steadyLight = await light.execute(1, {});
  const steadySpin = await spin.execute(1, {});
  expect(steadyLight.ok).toBe(true);
  expect(steadySpin.ok).toBe(true);
  expect((steadyLight.resources?.cpuUsedUs ?? 0) * 5).toBeLessThanOrEqual(
    steadySpin.resources?.cpuUsedUs ?? 0,
  );
});

test("promise results are rejected and queued jobs run after the commit inside the budget", async () => {
  const asyncPlayer = await create(
    "export default async ({game,Memory})=>{game.submit(({type:'move'}));}",
  );
  expect((await asyncPlayer.execute(0, {})).error?.type).toBe("ENTRYPOINT_ERROR");
  // V8 drains the microtask queue when the entry call returns: the action and
  // Memory were already serialized, so a job cannot change them, but its CPU
  // is billed to the same tick and a runaway job fails it.
  const quiet = await create(
    "export default ({game,Memory})=>{Promise.resolve().then(()=>{Memory.n=10});Memory.n=1;return game.submit({type:'move'})}",
  );
  expect(await quiet.execute(0, {})).toMatchObject({ ok: true, memory: { n: 1 } });
  const runaway = await create(
    "export default ({game,Memory})=>{Promise.resolve().then(()=>{while(true){}});Memory.n=1;return game.submit({type:'move'})}",
    { limits: limits({ cpuMs: 30 }) },
  );
  expect(await runaway.execute(0, {})).toMatchObject({
    ok: false,
    error: { type: "CPU_LIMIT" },
    memory: {},
  });
});

test("no Node, network, timers or host object references are exposed", async () => {
  const player = await create(
    "export default ({game,Memory})=>{\n    Memory.types=[typeof process,typeof require,typeof fetch,typeof setTimeout,typeof Buffer,typeof WebAssembly];\n    Memory.constructorRealm=console.log.constructor('return typeof process')();\n    return game.submit({type:'move'});\n  }",
  );
  const result = await player.execute(0, {});
  expect(result).toMatchObject({
    ok: true,
    memory: { types: Array(6).fill("undefined"), constructorRealm: "undefined" },
  });
});

test("logs are snapshots, bounded, ordered, and retained before CPU interruption", async () => {
  const player = await create(
    "export default ({game,Memory})=>{const x={n:1};console.info(x);x.n=2;console.warn('next');for(let i=0;i<20;i++)console.log('你好'.repeat(50));while(true){}}",
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
    "export default ({game,Memory})=>{for(let i=0;i<20;i++)console.log('0123456789');return game.submit({type:'move'})}",
    {
      captureLogs: true,
      logBudget: budget,
      limits: limits({ logs: { lineBytes: 16, tickBytes: 32, matchBytes: 40 } }),
    },
  );
  const b = await create(
    "export default ({game,Memory})=>{console.log('abcdefghij');return game.submit({type:'move'})}",
    {
      captureLogs: true,
      logBudget: budget,
      limits: limits({ logs: { lineBytes: 16, tickBytes: 32, matchBytes: 40 } }),
    },
  );
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
    "export default ({game,Memory})=>{console.log(new Proxy({}, {ownKeys(){while(true){}}}));return game.submit({type:'move'})}",
  );
  const result = await player.execute(0, {});
  expect(result.ok).toBe(true);
  expect(result).not.toHaveProperty("logs");
  expect(result).not.toHaveProperty("logsTruncated");
});

test("throw objects with hostile getters yield a bounded diagnostic", async () => {
  const player = await create(
    "export default ({game,Memory})=>{throw {get message(){while(true){}},get stack(){throw 1}}}",
  );
  expect(await player.execute(0, {})).toMatchObject({
    ok: false,
    error: { type: "RUNTIME_ERROR", message: "Player execution failed" },
  });
});

test("killed executors return an error, rebuild with a new generation, and retain Memory", async () => {
  const player = await create(
    "let calls=0;export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;return game.submit({type:'move',calls:++calls})}",
  );
  const before = await player.execute(0, {});
  process.kill(player.processId!, "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const failed = await player.execute(1, {});
  expect(failed).toMatchObject({ ok: false, memory: { n: 1 }, error: { type: "EXECUTOR_ERROR" } });
  const recovered = await player.execute(2, {});
  expect(recovered).toMatchObject({
    ok: true,
    action: { type: "move", calls: 1 },
    memory: { n: 2 },
  });
  expect(recovered.executionId).not.toBe(before.executionId);
});

test("a transient rebuild failure is retried on later ticks instead of wedging the player", async () => {
  const player = await create(
    "export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;return game.submit({type:'move'})}",
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
  // wallMs must clear the unbilled trusted per-tick setup (runtime, context,
  // SDK) on slow shared CI runners; a stopped process never answers at any
  // budget, so the watchdog semantics do not depend on the exact value.
  const budget = limits({ cpuMs: 40, wallMs: 400 });
  const player = await create(
    "export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;return game.submit({type:'move'})}",
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
  // Rebuilding is asynchronous and has its own startup budget, independent of this tick.
  await expect.poll(() => player.processId, { timeout: budget.startupMs }).toBeDefined();
  expect(player.processId).not.toBe(pid);
  expect(await player.execute(2, {})).toMatchObject({ ok: true, memory: { n: 2 } });
}, 10000);

test("platform input and trusted parser failures are system errors", async () => {
  const player = await create("export default ({game,Memory})=>{game.submit(({type:'move'}));}", {
    limits: limits({ observationBytes: 16 }),
  });
  await expect(player.execute(0, { text: "x".repeat(30) })).rejects.toBeInstanceOf(
    SandboxSystemError,
  );
  expect((await player.execute(0, {})).ok).toBe(true);
  const broken = await create(
    "export default ({game,Memory})=>{Memory.n=1;return game.submit({type:'move'})}",
    {
      parseAction() {
        throw new SandboxSystemError("Broken trusted game parser");
      },
    },
  );
  await expect(broken.execute(0, {})).rejects.toThrow("Broken trusted game parser");
  expect(broken.memory).toEqual({});
  const brokenSdk = await create(
    "export default ({game,Memory})=>{game.submit(({type:'move'}));}",
    {
      sdkSource: "throw new Error('SDK initialization failed');export default {}",
    },
  );
  await expect(brokenSdk.execute(0, {})).rejects.toBeInstanceOf(SandboxSystemError);
});

test("trusted SDK heap exhaustion is a system error while guest heap exhaustion stays a player error", async () => {
  const budget = limits({ heapBytes: 2 * 1024 * 1024 });
  const brokenSdk = await create(
    "export default ({game,Memory})=>{game.submit(({type:'move'}));}",
    {
      sdkSource: `const sink=[];for(;;)sink.push({a:[1,2,3]});export default{}`,
      limits: budget,
    },
  );
  await expect(brokenSdk.execute(0, {})).rejects.toBeInstanceOf(SandboxSystemError);
  const player = await create(
    "export default ({game,Memory})=>{Memory.n=1;if(game.fail){new ArrayBuffer(16*1024*1024)};return game.submit({type:'move'})}",
    { limits: budget },
  );
  expect(await player.execute(0, { fail: true })).toMatchObject({
    ok: false,
    error: { type: "HEAP_LIMIT" },
    memory: {},
  });
  expect(await player.execute(1, {})).toMatchObject({ ok: true, memory: { n: 1 } });
});

test("host observations follow strict JSON policy without advancing a rejected tick or Memory", async () => {
  const player = await create(
    "export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;return game.submit({type:'move'})}",
  );
  expect(await player.execute(0, {})).toMatchObject({ ok: true, memory: { n: 1 } });
  const getter = vi.fn(() => {
    throw new Error("Getter must not run");
  });
  for (const observation of [
    Object.defineProperty({}, "hidden", { value: 1 }),
    Object.defineProperty({}, "hidden", { get: getter }),
    Object.defineProperty({}, Symbol("hidden"), { value: 1 }),
    Object.defineProperty([1], "hidden", { value: 1 }),
  ]) {
    await expect(player.execute(1, observation)).rejects.toBeInstanceOf(SandboxSystemError);
    expect(player.memory).toEqual({ n: 1 });
  }
  expect(getter).not.toHaveBeenCalled();
  expect(await player.execute(1, {})).toMatchObject({ ok: true, memory: { n: 2 } });
});

test("expensive native regex work is bounded and the following tick can recover", async () => {
  const player = await create(
    "export default ({game,Memory})=>{if(game.fail) /^(a+)+$/.test('a'.repeat(40)+'b');return game.submit({type:'move'})}",
    { limits: limits({ cpuMs: 30, wallMs: 300 }) },
  );
  const output = await player.execute(0, { fail: true });
  expect(output.ok).toBe(false);
  expect(["CPU_LIMIT", "EXECUTION_TIMEOUT"]).toContain(output.error?.type);
  expect((await player.execute(1, {})).ok).toBe(true);
});

test("duplicate ticks, concurrent requests and closed players are rejected", async () => {
  const player = await create("export default ({game,Memory})=>{game.submit(({type:'move'}));}");
  const pending = player.execute(0, {});
  await expect(player.execute(1, {})).rejects.toThrow("Concurrent");
  await pending;
  await expect(player.execute(0, {})).rejects.toThrow("increasing");
  await player.close();
  await expect(player.execute(2, {})).rejects.toThrow("closed");
});

test.each([
  "import x from 'node:fs';export default ({game,Memory})=>{game.submit(x);}",
  "export * from 'x'",
  "export {x} from 'x'",
  "export default ({game,Memory})=>{game.submit(import('x'));}",
  "await Promise.resolve();export default ({game,Memory})=>{game.submit(1);}",
  "function broken( {",
])("isolated syntax validation rejects unsupported source: %s", async (source) => {
  expect(
    await validateSource({ source, limits: limits(), isolation: { kind: "local" } }),
  ).toMatchObject({ ok: false, error: { type: "ENTRYPOINT_ERROR" } });
});

test("compile-only validation never evaluates top-level player code", async () => {
  expect(
    await validateSource({
      source: "while(true){};export default ({game,Memory})=>{game.submit(1);}",
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

test("large valid sources stay playable within the default CPU budget", { retry: 2 }, async () => {
  const factor = await cpuSpeedFactor();
  // ~64KiB of statements: with the static check unbilled, tick 0 costs setup
  // plus compile; when the check was billed inside the window, the extra Acorn
  // parse put tick 0 near double. The scaled threshold sits between the two
  // with headroom on both sides.
  const filler = Array.from({ length: 3000 }, (_, i) => `const filler${i}=${i};`).join("");
  const player = await create(
    `${filler}export default ({game,Memory})=>{game.submit(({type:'move'}));}`,
    {
      // Wall time is not the property under test; a generous wall budget keeps a
      // busy parallel test run from turning spawn latency into a failure.
      limits: limits({ cpuMs: Math.ceil(100 * factor), wallMs: Math.ceil(2000 * factor) }),
    },
  );
  const first = await player.execute(0, {});
  expect(first.ok).toBe(true);
  expect(first.resources?.cpuUsedUs).toBeLessThan(45_000 * factor);
  expect((await player.execute(1, {})).ok).toBe(true);
});

test("steady-state ticks do not pay for static source checks", { retry: 2 }, async () => {
  const factor = await cpuSpeedFactor();
  // Re-parsing ~64KiB with Acorn on every tick roughly doubled steady-state
  // cost; the V8 compile alone stays far below the same scaled threshold.
  // The retry absorbs CPU-time inflation from a busy parallel test run.
  const filler = Array.from({ length: 3000 }, (_, i) => `const filler${i}=${i};`).join("");
  const player = await create(
    `${filler}export default ({game,Memory})=>{game.submit(({type:'move'}));}`,
    {
      limits: limits({ cpuMs: Math.ceil(100 * factor), wallMs: Math.ceil(1000 * factor) }),
    },
  );
  expect((await player.execute(0, {})).ok).toBe(true);
  const steady = await player.execute(1, {});
  expect(steady.ok).toBe(true);
  expect(steady.resources?.cpuUsedUs).toBeLessThan(20_000 * factor);
});

test(
  "large valid sources pass isolated validation under production budgets",
  { retry: 2 },
  async () => {
    const factor = await cpuSpeedFactor();
    // Billing the static check inside the validation window roughly doubled the
    // cost and rejected valid sources of this size as CPU_LIMIT; compile alone
    // fits the scaled budget with room to spare.
    const filler = Array.from({ length: 1500 }, (_, i) => `const filler${i}=${i};`).join("");
    expect(
      await validateSource({
        source: `${filler}export default ({game,Memory})=>{game.submit(({type:'move'}));}`,
        limits: limits({ cpuMs: Math.ceil(20 * factor), wallMs: Math.ceil(500 * factor) }),
        isolation: { kind: "local" },
      }),
    ).toEqual({ ok: true });
  },
);

test("trusted setup is never CPU-interrupted and the player budget covers guest work", async () => {
  // Top-level player work far beyond a 1ms budget. With whole-tick billing,
  // slow hosts tripped the interrupt during trusted bootstrap evaluation and
  // the match died as a system failure; guest-scoped billing degrades the tick
  // to a player CPU error instead, on every rebuild.
  const player = await create(
    "let s=0;for(let i=0;i<1e8;i++)s+=i;export default ({game,Memory})=>{game.submit(({type:'move'}));}",
    {
      limits: limits({ cpuMs: 1, wallMs: 5000 }),
    },
  );
  for (const tick of [0, 1]) {
    await expect(player.execute(tick, {})).resolves.toMatchObject({
      ok: false,
      action: { type: "idle" },
      error: { type: "CPU_LIMIT" },
    });
  }
});

test("sources rejected by the static check still fail the first tick as ENTRYPOINT_ERROR", async () => {
  const player = await create(
    "import x from 'x';export default ({game,Memory})=>{game.submit(({type:'move'}));}",
  );
  expect(await player.execute(0, {})).toMatchObject({
    ok: false,
    action: { type: "idle" },
    error: { type: "ENTRYPOINT_ERROR" },
  });
});
