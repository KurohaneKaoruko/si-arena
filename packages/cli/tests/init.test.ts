import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import {
  devkitDownloadPath,
  resolveResourceLimits,
  type DevkitDescriptor,
  type GameReleaseMetadata,
} from "@si-arena/protocol";
import { afterEach, expect, test } from "vitest";
import { initializeGame } from "../src/init";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const descriptor: DevkitDescriptor = {
  formatVersion: 1,
  game: {
    id: "counter",
    name: "Counter",
    description: "Test",
    release: "counter@1",
    botProtocolVersion: 1,
    minPlayers: 2,
    maxPlayers: 2,
    maxTicks: 3,
    config: {},
    resolvedLimits: resolveResourceLimits(),
  },
  engineCompatibility: "arena-engine-v1",
  components: { "@si-arena/cli": "0.0.0" },
  runtime: { node: ">=26", pnpm: ">=12", nodeVersion: "26.11.1", packageManager: "pnpm@12.14.0" },
  sourceLockSha256: "a".repeat(64),
};
function archive(change?: (files: Record<string, Uint8Array>) => void, prompt = "PROMPT.md") {
  const files = Object.fromEntries(
    [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "arena.mjs",
      "bot.js",
      "bots/official.js",
      "PROMPT.md",
      "SDK.md",
      "README.md",
      "dist/viewer/index.html",
    ].map((path) => [
      path,
      Buffer.from(
        path === "arena.mjs"
          ? 'throw new Error("must not execute during init")'
          : path === "PROMPT.md"
            ? prompt
            : path,
      ),
    ]),
  );
  const entries = Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [
      name,
      { bytes: bytes.length, sha256: sha(bytes) },
    ]),
  );
  const manifest = Buffer.from(JSON.stringify({ ...descriptor, files: entries }));
  const contents: Record<string, Uint8Array> = { ...files, "release.json": manifest };
  change?.(contents);
  const bytes = zipSync(contents);
  const metadata: GameReleaseMetadata = {
    ...descriptor,
    manifestSha256: sha(manifest),
    archive: {
      url: "/api/games/counter/releases/counter%401/download",
      bytes: bytes.length,
      sha256: sha(bytes),
    },
  };
  return { bytes, metadata };
}
async function fixture(pkg = archive(), later?: ReturnType<typeof archive>) {
  let selected = pkg;
  const directory = await mkdtemp(join(tmpdir(), "si-arena-init-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    if (request.url === "/api/games/counter") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(descriptor.game));
    } else if (request.url === "/api/games/counter/releases/counter%401") {
      response.end(JSON.stringify(selected.metadata));
      if (later) selected = later;
    } else if (
      request.url ===
      `/api/games/counter/releases/counter%401/devkits/${pkg.metadata.manifestSha256}`
    )
      response.end(JSON.stringify(pkg.metadata));
    else if (request.url === pkg.metadata.archive.url) response.end(pkg.bytes);
    else if (later && request.url === later.metadata.archive.url) response.end(later.bytes);
    else response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return { directory, paths, server: `http://127.0.0.1:${address.port}` };
}
test("pins the resolved release and initializes without loading modules or installing dependencies", async () => {
  const f = await fixture();
  const result = await initializeGame({
    gameId: "counter",
    directory: "bot with spaces",
    cwd: f.directory,
    server: f.server,
  });
  expect(result.release).toBe("counter@1");
  expect(f.paths).toEqual([
    "/api/games/counter",
    "/api/games/counter/releases/counter%401",
    "/api/games/counter/releases/counter%401/download",
  ]);
  expect(await readFile(join(result.directory, "bot.js"), "utf8")).toBe("bot.js");
  expect(await readdir(result.directory)).not.toContain("node_modules");
  expect(await readdir(f.directory)).toEqual(["bot with spaces"]);
});
test("explicit historical release skips the current alias and accepts an existing empty directory", async () => {
  const f = await fixture();
  await mkdir(join(f.directory, "bot"));
  await initializeGame({
    gameId: "counter",
    directory: "bot",
    cwd: f.directory,
    release: "counter@1",
    server: f.server,
  });
  expect(f.paths).toHaveLength(2);
  expect(f.paths).not.toContain("/api/games/counter");
});
test("refuses existing files before downloading and leaves them intact", async () => {
  const f = await fixture();
  await mkdir(join(f.directory, "bot"));
  await writeFile(join(f.directory, "bot", "mine.js"), "keep");
  await expect(
    initializeGame({ gameId: "counter", directory: "bot", cwd: f.directory, server: f.server }),
  ).rejects.toThrow("absent or empty");
  expect(f.paths).toEqual([]);
  expect(await readFile(join(f.directory, "bot", "mine.js"), "utf8")).toBe("keep");
});
test.each([
  "../escape.js",
  "/absolute.js",
  "C:/escape.js",
  "directory/../../escape.js",
  "NUL.txt",
  "folder./file.js",
])("rejects ZIP path %s without leaving a project", async (path) => {
  const f = await fixture(
    archive((files) => {
      files[path] = Buffer.from("bad");
    }),
  );
  await expect(
    initializeGame({ gameId: "counter", directory: "bot", cwd: f.directory, server: f.server }),
  ).rejects.toThrow("Unsafe");
  expect(await readdir(f.directory)).toEqual([]);
});
test("rejects duplicate case-folded names and files with an invalid internal checksum", async () => {
  for (const change of [
    (files: Record<string, Uint8Array>) => {
      files["BOT.js"] = Buffer.from("duplicate");
    },
    (files: Record<string, Uint8Array>) => {
      files["bot.js"] = Buffer.from("tampered");
    },
  ]) {
    const f = await fixture(archive(change));
    await expect(
      initializeGame({ gameId: "counter", directory: "bot", cwd: f.directory, server: f.server }),
    ).rejects.toThrow();
    expect(await readdir(f.directory)).toEqual([]);
  }
});
test("rejects archive and descriptor mismatches while preserving preexisting empty directories", async () => {
  for (const kind of ["archive", "descriptor"]) {
    const pkg = archive();
    if (kind === "archive") pkg.metadata.archive.sha256 = "0".repeat(64);
    else pkg.metadata.components["@si-arena/cli"] = "different";
    const f = await fixture(pkg);
    await mkdir(join(f.directory, "bot"));
    await expect(
      initializeGame({ gameId: "counter", directory: "bot", cwd: f.directory, server: f.server }),
    ).rejects.toThrow();
    expect(await readdir(join(f.directory, "bot"))).toEqual([]);
    expect(await readdir(f.directory)).toEqual(["bot"]);
  }
});
test.each([
  "ftp://example.com",
  "https://user:password@example.com",
  "https://example.com/#fragment",
])("rejects a server URL outside the accepted origin shape: %s", async (server) => {
  await expect(initializeGame({ gameId: "counter", directory: "unused", server })).rejects.toThrow(
    "--server accepts only a plain HTTP(S) origin",
  );
});
test("honors cancellation without leaving files", async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    initializeGame({
      gameId: "counter",
      directory: "bot",
      cwd: f.directory,
      server: f.server,
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(await readdir(f.directory)).toEqual([]);
});

test("pins development revisions across a selector switch and supports explicit revision downloads", async () => {
  const first = archive(undefined, "first prompt");
  const second = archive(undefined, "second prompt");
  for (const pkg of [first, second])
    pkg.metadata.archive.url = devkitDownloadPath(
      "counter",
      "counter@1",
      pkg.metadata.manifestSha256,
    );
  const f = await fixture(first, second);
  const options = { gameId: "counter", cwd: f.directory, server: f.server };
  const result = await initializeGame({ ...options, directory: "first" });
  expect(result.revision).toBe(first.metadata.manifestSha256);
  expect(await readFile(join(result.directory, "PROMPT.md"), "utf8")).toBe("first prompt");
  const latest = await initializeGame({ ...options, directory: "latest" });
  expect(latest.release).toBe(result.release);
  expect(latest.revision).toBe(second.metadata.manifestSha256);
  const pinned = await initializeGame({
    ...options,
    directory: "pinned",
    release: result.release,
    revision: result.revision,
  });
  expect(pinned.revision).toBe(result.revision);
  expect(await readFile(join(pinned.directory, "PROMPT.md"), "utf8")).toBe("first prompt");
  await expect(
    initializeGame({ ...options, directory: "invalid", revision: result.revision }),
  ).rejects.toThrow("requires --release");
  await expect(
    initializeGame({
      ...options,
      directory: "invalid",
      release: result.release,
      revision: "../escape",
    }),
  ).rejects.toThrow("SHA-256");
});
