import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { get } from "node:http";
import { resolveResourceLimits, type JsonObject, type Replay } from "@si-arena/protocol";
import { runCli } from "../src";
import { DevSession, serveDev } from "../src/dev";
import type { LocalGameRegistration, LocalSummary } from "../src/local-game";
import { fixture } from "./fixture";

interface SessionStatus {
  current: { phase: string; run: number; seed: number; completedTicks: number };
  lastCompleted: { run: number; matchId: string; finalStateHash: string } | null;
}

async function pollStatus(url: URL, check: (status: SessionStatus) => boolean, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = (await (await fetch(url)).json()) as SessionStatus;
    if (check(status)) return status;
    if (Date.now() > deadline) throw new Error("Dev session did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("dev serves a live session with replay, memory and restart endpoints", async () => {
  const f = await fixture(
    `export default ({Memory})=>{Memory.n=(Memory.n??0)+1;return {add:Memory.n}}`,
  );
  const pages = await mkdtemp(join(tmpdir(), "si-arena-dev-"));
  await writeFile(join(pages, "dev.html"), "<h1>dev page</h1>");
  const cancellation = new AbortController();
  let ready!: (url: string) => void;
  const address = new Promise<string>((resolve) => {
    ready = resolve;
  });
  const running = runCli(["dev", "--bot", f.path, "--seed", "42"], {
    ...f.context,
    viewerDirectory: pages,
    signal: cancellation.signal,
    write(line) {
      f.lines.push(line);
      if (JSON.parse(line).type === "dev") ready((JSON.parse(line) as { url: string }).url);
    },
  });
  try {
    const url = new URL(await address);
    expect(await (await fetch(url)).text()).toContain("dev page");
    const status = await pollStatus(
      new URL("/api/session", url),
      (value) => value.current.phase === "completed",
    );
    expect(status.current).toMatchObject({ run: 1, seed: 42, completedTicks: 3 });
    expect(status.lastCompleted).toMatchObject({ run: 1, seed: 42 });
    const replay = (await (await fetch(new URL("/api/session/replay", url))).json()) as Replay<
      unknown,
      unknown
    >;
    expect(replay.matchId).toBe(status.lastCompleted!.matchId);
    expect(replay.ticks).toHaveLength(3);
    expect(replay.players.map((player) => player.id)).toEqual(["bot", "official-1"]);
    expect(JSON.stringify(replay)).not.toContain('"n"');
    const matchLine = f.lines
      .map((line) => JSON.parse(line))
      .find((record) => record.type === "match");
    expect(matchLine).toMatchObject({ run: 1, seed: 42, errorCount: 0 });
    expect("replayData" in matchLine).toBe(false);

    const memory0 = (await (await fetch(new URL("/api/session/memory?tick=0", url))).json()) as {
      players: Record<string, { before: unknown; after: unknown }>;
    };
    expect(memory0.players.bot).toEqual({ before: {}, after: { n: 1 } });
    expect(memory0.players["official-1"]).toEqual({ before: {}, after: {} });
    const memory1 = (await (await fetch(new URL("/api/session/memory?tick=1", url))).json()) as {
      players: Record<string, { before: unknown; after: unknown }>;
    };
    expect(memory1.players.bot).toEqual({ before: { n: 1 }, after: { n: 2 } });
    const memory3 = (await (await fetch(new URL("/api/session/memory?tick=3", url))).json()) as {
      players: Record<string, { before: unknown; after: unknown }>;
    };
    expect(memory3.players.bot).toEqual({ before: { n: 3 }, after: { n: 3 } });
    expect((await fetch(new URL("/api/session/memory?tick=x", url))).status).toBe(400);

    await fetch(new URL("/api/session/restart", url), { method: "POST" });
    const restarted = await pollStatus(
      new URL("/api/session", url),
      (value) => value.current.phase === "completed" && value.current.run === 2,
    );
    expect(restarted.current.seed).toBe(42);
    expect(restarted.lastCompleted!.finalStateHash).toBe(status.lastCompleted!.finalStateHash);
    const reseeded = await fetch(new URL("/api/session/restart", url), {
      method: "POST",
      body: JSON.stringify({ seed: 7 }),
    });
    expect(await reseeded.json()).toMatchObject({ ok: true, run: 3, seed: 7 });
    const final = await pollStatus(
      new URL("/api/session", url),
      (value) => value.current.phase === "completed" && value.current.run === 3,
    );
    expect(final.current.seed).toBe(7);

    expect(
      (
        await fetch(new URL("/api/session/restart", url), {
          method: "POST",
          headers: { origin: "http://evil.example" },
        })
      ).status,
    ).toBe(403);
    const sameOrigin = await fetch(new URL("/api/session/restart", url), {
      method: "POST",
      headers: { origin: url.origin },
    });
    expect(sameOrigin.status).toBe(200);
    expect(await sameOrigin.json()).toMatchObject({ ok: true, run: 4 });

    const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
      get(url, { headers: { host: "attacker.example" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    expect(foreignHost).toBe(403);
    expect((await fetch(new URL("/package.json", url))).status).toBe(404);
    expect((await fetch(url, { method: "POST" })).status).toBe(403);
    expect(
      (
        await fetch(new URL("/api/session/restart", url), {
          method: "POST",
          body: JSON.stringify({ seed: "x" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(new URL("/api/session/restart", url), {
          method: "POST",
          body: '"'.repeat(2048),
        })
      ).status,
    ).toBe(400);
    cancellation.abort();
    await running;
    await expect(fetch(url)).rejects.toThrow();
  } finally {
    cancellation.abort();
    await running;
    await rm(pages, { recursive: true, force: true });
    await f.cleanup();
  }
}, 30000);

function stubSummary(matchId: string): LocalSummary & { replayData: Replay<unknown, unknown> } {
  const result = {
    reason: "tick-limit",
    completedTicks: 5,
    players: [
      { id: "bot", rank: 1, score: 5 },
      { id: "official-1", rank: 2, score: 0 },
    ],
  };
  return {
    matchId,
    result,
    finalStateHash: `hash-${matchId}`,
    errorCount: 0,
    logCount: 0,
    truncatedTicks: 0,
    replayData: {
      formatVersion: 1,
      matchId,
      game: { id: "stub", release: "stub@1", botProtocolVersion: 1, engineCompatibility: "stub@1" },
      players: [
        { id: "bot", slot: 0, name: "bot.js", official: false },
        { id: "official-1", slot: 1, name: "Official", official: true },
      ],
      config: {},
      resolvedLimits: resolveResourceLimits({}),
      initialState: { tick: 0 },
      ticks: [],
      result,
      finalStateHash: `hash-${matchId}`,
    },
  };
}

function stubbedRegistration() {
  const signals: AbortSignal[] = [];
  const pending: Array<{
    resolve: (summary: LocalSummary & { replayData?: unknown }) => void;
    reject: (error: Error) => void;
    onMemory: ((playerId: string, tick: number, memory: JsonObject) => void) | undefined;
  }> = [];
  let failPrepare = false;
  let completed = 0;
  const registration = {
    manifest: {
      id: "stub",
      name: "Stub",
      description: "State machine fixture",
      release: "stub@1",
      botProtocolVersion: 1,
      minPlayers: 2,
      maxPlayers: 2,
      maxTicks: 5,
      config: {},
      resolvedLimits: resolveResourceLimits({}),
    },
    async prepare(botPaths: readonly string[], prepareSignal?: AbortSignal) {
      if (failPrepare)
        throw new Error("bot.js: ENTRYPOINT_ERROR: Invalid or unsupported player module");
      signals.push(prepareSignal ?? new AbortController().signal);
      return {
        players: [
          { id: "bot", slot: 0, name: "bot.js", official: false },
          { id: "official-1", slot: 1, name: "Official", official: true },
        ],
        run({
          signal: runSignal,
          onMemory,
        }: {
          signal?: AbortSignal;
          onMemory?: (playerId: string, tick: number, memory: JsonObject) => void;
        }) {
          return new Promise((resolve, reject) => {
            const entry = { resolve, reject, onMemory };
            pending.push(entry);
            runSignal?.addEventListener(
              "abort",
              // Mirror runMatch unwinding cost so races with restart/dispose are observable.
              () => {
                setTimeout(() => {
                  const index = pending.indexOf(entry);
                  if (index >= 0) pending.splice(index, 1);
                  reject(new Error("Match cancelled"));
                }, 20);
              },
              { once: true },
            );
          });
        },
      };
    },
    async verify() {
      throw new Error("unused");
    },
  } as unknown as LocalGameRegistration;
  return {
    registration,
    signals,
    completeRun() {
      const entry = pending.shift()!;
      const matchId = `stub-${++completed}`;
      entry.onMemory?.("bot", 0, { matchId });
      entry.resolve(stubSummary(matchId));
    },
    failNextPrepare() {
      failPrepare = true;
    },
  };
}

test("restart aborts the running match and validation failures keep the last completed match", async () => {
  const lines: string[] = [];
  const stub = stubbedRegistration();
  const session = new DevSession({
    registration: stub.registration,
    botPaths: ["/unused/bot.js"],
    seed: 42,
    write: (line) => lines.push(line),
  });
  expect(session.status().current).toMatchObject({
    phase: "running",
    run: 1,
    seed: 42,
    completedTicks: 0,
  });
  await session.restart();
  expect(stub.signals[0]!.aborted).toBe(true);
  expect(session.status().current).toMatchObject({ phase: "running", run: 2 });
  expect(session.replay).toBeUndefined();
  stub.completeRun();
  await session.idle();
  expect(session.status().current).toMatchObject({ phase: "completed", run: 2 });
  expect(session.replay?.matchId).toMatch(/^stub-/);
  expect(session.memorySnapshot(0).players.bot).toEqual({
    before: {},
    after: { matchId: "stub-1" },
  });
  expect(lines.filter((line) => JSON.parse(line).type === "match")).toHaveLength(1);

  stub.failNextPrepare();
  await session.restart();
  await session.idle();
  const status = session.status();
  expect(status.current.phase).toBe("error");
  expect(status.current.message).toMatch(/ENTRYPOINT_ERROR/);
  expect(status.lastCompleted).toMatchObject({ run: 2 });
  expect(session.replay).toBeDefined();
  expect(lines.some((line) => JSON.parse(line).type === "error")).toBe(true);
  // The failed run's empty trace must not rewrite Memory under the old replay.
  expect(session.memorySnapshot(0).players.bot).toEqual({
    before: {},
    after: { matchId: "stub-1" },
  });
  await session.dispose();
});

test("disposing during a queued restart never starts an unowned match", async () => {
  const stub = stubbedRegistration();
  const session = new DevSession({
    registration: stub.registration,
    botPaths: ["/unused/bot.js"],
    seed: 42,
    write: () => {},
  });
  const restarting = session.restart(7);
  // Let the queued restart abort run 1 and settle into awaiting its unwind.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await session.dispose();
  await restarting;
  expect(session.run).toBe(1);
  expect(stub.signals).toHaveLength(1);
  expect(stub.signals[0]!.aborted).toBe(true);
});

test("serveDev requires the dev page assets", async () => {
  const pages = await mkdtemp(join(tmpdir(), "si-arena-dev-empty-"));
  const f = await fixture();
  try {
    await expect(
      serveDev({
        directory: pages,
        registration: f.registration,
        botPaths: [f.path],
        seed: 42,
        write: () => {},
      }),
    ).rejects.toThrow(/development package/);
  } finally {
    await rm(pages, { recursive: true, force: true });
    await f.cleanup();
  }
});
