import { expect, test, vi } from "vitest";
import { resolveResourceLimits, type JsonValue } from "@si-arena/protocol";
import {
  createSandboxExecutor,
  SandboxPlayer,
  SandboxSystemError,
  type SandboxOptions,
} from "../src";

function options(): Omit<SandboxOptions<JsonValue>, "defaultAction"> {
  return {
    matchId: "executor-match",
    playerId: "bot",
    source: `export default ({observation,Memory,sdk})=>{
      Memory.n=(Memory.n??0)+1;console.log(Memory.n);
      if(observation.fail)throw new Error('tick failed');
      return sdk.move(Memory.n);
    }`,
    sdkSource: "export default {move(n){return {type:'move',n}}}",
    limits: resolveResourceLimits({ cpuMs: 100, wallMs: 1000 }),
    isolation: { kind: "local" },
    captureLogs: true,
    parseAction(action) {
      return { ok: true, action };
    },
  };
}

test("the shared adapter starts lazily, reuses its player and forwards per-tick fallbacks", async () => {
  const create = vi.spyOn(SandboxPlayer, "create");
  const executor = createSandboxExecutor(options());
  try {
    expect(create).not.toHaveBeenCalled();
    expect(await executor.execute(0, {}, { type: "idle" })).toMatchObject({
      ok: true,
      action: { type: "move", n: 1 },
      memory: { n: 1 },
      logs: [{ level: "log", message: "1" }],
    });
    expect(
      await executor.execute(1, { fail: true }, { type: "idle", reason: "tick-1" }),
    ).toMatchObject({
      ok: false,
      action: { type: "idle", reason: "tick-1" },
      memory: { n: 1 },
      error: { type: "RUNTIME_ERROR" },
    });
    expect(await executor.execute(2, {}, { type: "idle" })).toMatchObject({
      ok: true,
      action: { type: "move", n: 2 },
      memory: { n: 2 },
    });
    expect(create).toHaveBeenCalledTimes(1);
  } finally {
    await executor.close();
  }
  await expect(executor.execute(3, {}, { type: "idle" })).rejects.toBeInstanceOf(
    SandboxSystemError,
  );
});

test("closing before the first tick never creates a player", async () => {
  const create = vi.spyOn(SandboxPlayer, "create");
  const executor = createSandboxExecutor(options());
  await Promise.all([executor.close(), executor.close()]);
  await expect(executor.execute(0, {}, { type: "idle" })).rejects.toThrow("closed");
  expect(create).not.toHaveBeenCalled();
});

test("close waits for pending startup, releases the player once and prevents tick execution", async () => {
  const player = await SandboxPlayer.create({ ...options(), defaultAction: { type: "idle" } });
  const execute = vi.spyOn(player, "execute");
  const close = vi.spyOn(player, "close");
  let release!: (player: SandboxPlayer<JsonValue>) => void;
  const startup = new Promise<SandboxPlayer<JsonValue>>((resolve) => {
    release = resolve;
  });
  vi.spyOn(SandboxPlayer, "create").mockReturnValueOnce(startup);
  const executor = createSandboxExecutor(options());
  const running = executor.execute(0, {}, { type: "idle" });
  const rejected = expect(running).rejects.toThrow("closed");
  const closing = executor.close();
  const closed = vi.fn();
  void closing.then(closed);
  try {
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();
    release(player);
    await Promise.all([rejected, closing, executor.close()]);
    expect(execute).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    release(player);
    await Promise.allSettled([running, closing]);
    await player.close();
  }
});

test("startup failures remain system failures", async () => {
  const failure = new SandboxSystemError("Cannot start player");
  vi.spyOn(SandboxPlayer, "create").mockRejectedValueOnce(failure);
  const executor = createSandboxExecutor(options());
  await expect(executor.execute(0, {}, { type: "idle" })).rejects.toBe(failure);
  await expect(executor.close()).rejects.toBe(failure);
});
