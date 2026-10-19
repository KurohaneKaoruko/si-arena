import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, test } from "vitest";
import { replayMatch, runMatch } from "../src";
import { ReplayFileSink, readReplayFile } from "../src/node";
import { fixture, toyGame, type ToyState, type ToyAction } from "./helpers";

const paths: string[] = [];
afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "si-arena-engine-"));
  paths.push(path);
  return path;
}

test("gzip stream reconstructs a complete replay with no intermediate state snapshots", async () => {
  const path = join(await directory(), "match.json.gz");
  const f = fixture({ sink: new ReplayFileSink<ToyState, ToyAction>(path) });
  const summary = await runMatch(f.options);
  const raw = await readReplayFile(path);
  expect((await replayMatch(raw, toyGame)).finalStateHash).toBe(summary.finalStateHash);
  expect((await readdir(join(path, ".."))).length).toBe(1);
});

test("destination files are never overwritten, including on failed completion", async () => {
  const dir = await directory(),
    path = join(dir, "match.json.gz");
  await writeFile(path, "keep me");
  const f = fixture({ sink: new ReplayFileSink<ToyState, ToyAction>(path) });
  await expect(runMatch(f.options)).rejects.toThrow("EEXIST");
  expect(await readFile(path, "utf8")).toBe("keep me");
  expect(await readdir(dir)).toEqual(["match.json.gz"]);
});

test("trusted rules failure removes private partial files and does not create a final replay", async () => {
  const dir = await directory(),
    path = join(dir, "match.json.gz");
  const game = {
    ...toyGame,
    rules: {
      ...toyGame.rules,
      step() {
        throw new Error("bad rules");
      },
    },
  };
  const f = fixture({ game, sink: new ReplayFileSink<ToyState, ToyAction>(path) });
  await expect(runMatch(f.options)).rejects.toThrow("bad rules");
  expect(await readdir(dir)).toEqual([]);
});

test("writers enforce an explicit uncompressed size ceiling", async () => {
  const dir = await directory();
  const f = fixture({
    sink: new ReplayFileSink<ToyState, ToyAction>(join(dir, "tiny.json.gz"), 64),
  });
  await expect(runMatch(f.options)).rejects.toThrow("byte limit");
  expect(await readdir(dir)).toEqual([]);
});

test("readers bound compressed bytes, expansion and malformed gzip/JSON", async () => {
  const dir = await directory(),
    path = join(dir, "replay.json.gz");
  await writeFile(path, gzipSync('"' + "x".repeat(100000) + '"'));
  await expect(readReplayFile(path, { maxBytes: 32 })).rejects.toThrow("Expanded");
  await expect(readReplayFile(path, { maxCompressedBytes: 10 })).rejects.toThrow("Compressed");
  await writeFile(path, "not gzip");
  await expect(readReplayFile(path)).rejects.toThrow();
  await writeFile(path, gzipSync("not json"));
  await expect(readReplayFile(path)).rejects.toThrow();
  await writeFile(path, gzipSync(Buffer.from([0x22, 0xff, 0x22])));
  await expect(readReplayFile(path)).rejects.toThrow();
  await expect(readReplayFile(join(dir, "missing.json.gz"))).rejects.toThrow("ENOENT");
});
