import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { readReplayFile } from "@si-arena/engine/node";
import type { Replay } from "@si-arena/protocol";
import { cloneJson } from "@si-arena/protocol";
import { runCli } from "../src";
import { fixture, localGame } from "./fixture";

test("batch runs reset Memory, wrap seeds and retain runtime errors/logs", async () => {
  const f = await fixture(
    "export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;console.log(Memory.n);if(game.tick===1)throw new Error('oops');return game.submit({add:Memory.n})}",
  );
  try {
    await runCli(
      ["run", "--bot", f.path, "--matches", "2", "--seed", "4294967295", "--out", "my replays"],
      f.context,
    );
    const records = f.lines.map((line) => JSON.parse(line));
    expect(records[0].resolvedLimits).toEqual(f.registration.manifest.resolvedLimits);
    expect(records[0].isolation.processMemoryEnforced).toBe(false);
    const matches = records.filter((record) => record.type === "match");
    expect(matches.map((match) => match.seed)).toEqual([0xffffffff, 0]);
    expect(matches.map((match) => match.result.players[0].score)).toEqual([3, 3]);
    expect(matches.map((match) => match.errorCount)).toEqual([1, 1]);
    expect(records.at(-1)).toMatchObject({
      type: "batch",
      matches: 2,
      wins: 2,
      draws: 0,
      losses: 0,
      errorCount: 2,
    });
    const raw = (await readReplayFile(matches[0].replay)) as Replay<unknown, unknown>;
    expect(raw.players[1]).toMatchObject({ id: "official-1", official: true });
    expect(raw.ticks[1]?.errors?.bot?.type).toBe("RUNTIME_ERROR");
    expect(raw.ticks.flatMap((tick) => tick.logs?.bot ?? []).map((log) => log.message)).toEqual([
      "1",
      "2",
      "2",
    ]);
    expect(JSON.stringify(raw)).not.toContain("export default");
    expect(raw.ticks.some((tick) => "memory" in tick || "state" in tick)).toBe(false);
    expect(await readdir(join(f.cwd, "my replays"))).toHaveLength(2);
    await rm(f.path);
    await rm(f.official);
    f.lines.length = 0;
    await runCli(["replay", matches[0].replay, "--verify", "--logs"], f.context);
    const replayed = f.lines.map((line) => JSON.parse(line));
    expect(
      replayed.filter((record) => record.kind === "log").map((record) => record.log.message),
    ).toEqual(["1", "2", "2"]);
    expect(replayed.find((record) => record.kind === "error").error.type).toBe("RUNTIME_ERROR");
    expect(replayed.at(-1)).toMatchObject({
      type: "replay",
      verified: true,
      finalStateHash: matches[0].finalStateHash,
    });
  } finally {
    await f.cleanup();
  }
}, 15000);

test("prepared sessions keep source snapshots, reset globals and Memory between matches, and preserve destinations", async () => {
  const f = await fixture(
    "let calls=0;export default ({game,Memory})=>{Memory.n=(Memory.n??0)+1;return game.submit({add:++calls})}",
  );
  try {
    const session = await f.registration.prepare([f.path]);
    await writeFile(f.path, "export default ({game,Memory})=>{game.submit(({add:9}));}");
    const first = await session.run({ seed: 42, replay: join(f.cwd, "first.json.gz") });
    const second = await session.run({ seed: 42, replay: join(f.cwd, "second.json.gz") });
    expect(first.result.players[0]?.score).toBe(6);
    expect(second.finalStateHash).toBe(first.finalStateHash);
    expect(second.matchId).not.toBe(first.matchId);
    const original = await readFile(join(f.cwd, "first.json.gz"));
    await expect(session.run({ seed: 1, replay: join(f.cwd, "first.json.gz") })).rejects.toThrow();
    expect(await readFile(join(f.cwd, "first.json.gz"))).toEqual(original);
    expect((await readdir(f.cwd)).some((name) => name.endsWith(".partial"))).toBe(false);
  } finally {
    await f.cleanup();
  }
}, 15000);

test("CLI replay verification rejects a different release or protocol", async () => {
  const f = await fixture();
  try {
    const prepared = await f.registration.prepare([f.path]);
    const result = await prepared.run({ seed: 42 });
    const replay = cloneJson(result.replayData!);
    expect((await f.registration.verify(replay)).finalStateHash).toBe(result.finalStateHash);
    replay.game.release = "counter@old";
    await expect(f.registration.verify(replay)).rejects.toThrow("different trusted game release");
    replay.game.release = localGame.manifest.release;
    replay.game.botProtocolVersion++;
    await expect(f.registration.verify(replay)).rejects.toThrow("different trusted game release");
  } finally {
    await f.cleanup();
  }
});

test("local opponents are ordinary sandboxed players and the CLI supports more than two seats", async () => {
  const f = await fixture();
  try {
    const opponent = join(f.cwd, "opponent.js");
    await writeFile(opponent, "export default ({game,Memory})=>{game.submit(({add:2}));}");
    await runCli(
      ["run", "--bot", f.path, "--opponent", opponent, "--opponent", opponent],
      f.context,
    );
    const records = f.lines.map((line) => JSON.parse(line));
    expect(records[0].players).toHaveLength(3);
    expect(records[0].players.every((player: { official: boolean }) => !player.official)).toBe(
      true,
    );
    expect(records.at(-1)).toMatchObject({ losses: 1 });
  } finally {
    await f.cleanup();
  }
}, 15000);

test("bad source, oversize files and invalid UTF-8 fail before creating matches", async () => {
  const f = await fixture();
  try {
    for (const source of [
      "export default {",
      Buffer.alloc(f.registration.manifest.resolvedLimits.codeBytes + 1),
      Buffer.from([0xff]),
    ]) {
      await writeFile(f.path, source);
      await expect(runCli(["run", "--bot", f.path], f.context)).rejects.toThrow();
      expect(f.lines).toHaveLength(0);
      expect(await readdir(f.cwd)).not.toContain("replays");
    }
    const directory = join(f.cwd, "directory");
    await mkdir(directory);
    await expect(runCli(["run", "--bot", directory], f.context)).rejects.toThrow(/regular file/);
  } finally {
    await f.cleanup();
  }
});

test("untrusted replay failures never emit logs or load bots", async () => {
  const f = await fixture(
    "export default ({game,Memory})=>{console.log('do not print unverified data');return game.submit({add:1})}",
  );
  try {
    await runCli(["run", "--bot", f.path], f.context);
    const match = f.lines.map((line) => JSON.parse(line)).find((record) => record.type === "match");
    const raw = (await readReplayFile(match.replay)) as Replay<unknown, unknown>;
    for (const corrupt of [
      { ...raw, finalStateHash: "0".repeat(64) },
      { ...raw, game: { ...raw.game, release: "counter@unregistered" } },
      { ...raw, game: { ...raw.game, module: "file:///do-not-load.mjs" } },
    ]) {
      const path = join(f.cwd, "corrupt.json.gz");
      await writeFile(path, gzipSync(JSON.stringify(corrupt)));
      f.lines.length = 0;
      await expect(runCli(["replay", path, "--verify", "--logs"], f.context)).rejects.toThrow();
      expect(f.lines).toHaveLength(0);
    }
  } finally {
    await f.cleanup();
  }
});

test("cancelling a batch after a completed match keeps it and starts no further matches", async () => {
  const f = await fixture();
  const cancellation = new AbortController();
  try {
    await expect(
      runCli(["run", "--bot", f.path, "--matches", "3"], {
        ...f.context,
        signal: cancellation.signal,
        write(line) {
          f.lines.push(line);
          if (JSON.parse(line).type === "match") cancellation.abort();
        },
      }),
    ).rejects.toThrow(/cancelled/);
    const files = await readdir(join(f.cwd, "replays"));
    expect(files).toHaveLength(1);
    expect(
      (await f.registration.verify(await readReplayFile(join(f.cwd, "replays", files[0]!)))).result
        .completedTicks,
    ).toBe(3);
    expect(f.lines.map((line) => JSON.parse(line)).some((record) => record.type === "batch")).toBe(
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("runtime globals cannot reach the Node host through local bot files", async () => {
  const f = await fixture(
    "export default ({game,Memory})=>{process.exit(23);return game.submit({add:1})}",
  );
  try {
    await runCli(["run", "--bot", f.path], f.context);
    const records = f.lines.map((line) => JSON.parse(line));
    expect(records.at(-1)).toMatchObject({ errorCount: 3, draws: 1 });
  } finally {
    await f.cleanup();
  }
});

test("cancellation during executor startup/execution removes the unfinished replay", async () => {
  const f = await fixture("export default ({game,Memory})=>{while(true){}}");
  const cancellation = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const session = await f.registration.prepare([f.path]);
    const running = session.run({
      seed: 42,
      replay: join(f.cwd, "cancelled.json.gz"),
      signal: cancellation.signal,
    });
    timer = setTimeout(() => cancellation.abort(), 30);
    await expect(running).rejects.toThrow(/cancelled/);
    expect(
      (await readdir(f.cwd)).filter((name) => name.endsWith(".partial") || name.endsWith(".gz")),
    ).toEqual([]);
  } finally {
    clearTimeout(timer);
    await f.cleanup();
  }
});
