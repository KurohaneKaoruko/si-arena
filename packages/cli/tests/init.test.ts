import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import {
  devkitDownloadPath,
  resolveResourceLimits,
  type DevkitDescriptor,
  type GameReleaseMetadata,
} from "@si-arena/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { initializeGame } from "../src/init";
import { updateGame } from "../src/update";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
function archive(
  change?: (files: Record<string, Uint8Array>) => void,
  prompt = "PROMPT.md",
  sourceChanges?: (files: Record<string, Uint8Array>) => void,
) {
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
  sourceChanges?.(files);
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
      url: devkitDownloadPath("counter"),
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
    if (request.url === "/api/games/counter/devkit") {
      response.end(JSON.stringify(selected.metadata));
      if (later) selected = later;
    } else if (request.url === devkitDownloadPath("counter")) {
      if (request.headers["if-match"] !== `"${selected.metadata.archive.sha256}"`)
        response.writeHead(412).end();
      else response.end(selected.bytes);
    } else response.writeHead(404).end();
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
  return {
    directory,
    paths,
    server: `http://127.0.0.1:${address.port}`,
    select: (nextPackage: ReturnType<typeof archive>) => {
      selected = nextPackage;
    },
  };
}
test("downloads the current package and initializes without loading modules or installing dependencies", async () => {
  const f = await fixture();
  const result = await initializeGame({
    gameId: "counter",
    directory: "bot with spaces",
    cwd: f.directory,
    server: f.server,
  });
  expect(result.release).toBe("counter@1");
  expect(f.paths).toEqual(["/api/games/counter/devkit", "/api/games/counter/download"]);
  expect(await readFile(join(result.directory, "bot.js"), "utf8")).toBe("bot.js");
  expect(await readdir(result.directory)).not.toContain("node_modules");
  expect(await readdir(f.directory)).toEqual(["bot with spaces"]);
});
test("accepts an existing empty directory", async () => {
  const f = await fixture();
  await mkdir(join(f.directory, "bot"));
  await initializeGame({
    gameId: "counter",
    directory: "bot",
    cwd: f.directory,
    server: f.server,
  });
  expect(f.paths).toHaveLength(2);
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

test("retries a package replacement between metadata and archive requests", async () => {
  const f = await fixture(archive(undefined, "first"), archive(undefined, "latest"));
  const result = await initializeGame({
    gameId: "counter",
    directory: "bot",
    cwd: f.directory,
    server: f.server,
  });
  expect(await readFile(join(result.directory, "PROMPT.md"), "utf8")).toBe("latest");
  expect(f.paths).toHaveLength(4);
});

test("updates managed files, backs up local changes, removes stale vendor files and preserves player work", async () => {
  const first = archive(undefined, "first", (files) => {
    files["vendor/old.tgz"] = Buffer.from("old");
  });
  const f = await fixture(first);
  const { directory } = await initializeGame({
    gameId: "counter",
    directory: "bot",
    cwd: f.directory,
    server: f.server,
  });
  await writeFile(join(directory, "bot.js"), "my strategy");
  await writeFile(join(directory, "SDK.md"), "my notes");
  await mkdir(join(directory, "research"));
  await writeFile(join(directory, "research/best.js"), "best");
  await mkdir(join(directory, "replays"));
  await writeFile(join(directory, "replays/keep.json.gz"), "replay");
  await writeFile(join(directory, "bots/custom.js"), "custom");
  f.select(
    archive(undefined, "latest", (files) => {
      files["vendor/new.tgz"] = Buffer.from("new");
    }),
  );
  const result = await updateGame({ cwd: directory });
  expect(result.updated).toBe(true);
  expect(await readFile(join(directory, "PROMPT.md"), "utf8")).toBe("latest");
  expect(await readFile(join(directory, "SDK.md"), "utf8")).toBe("SDK.md");
  expect(await readFile(join(result.backup!, "SDK.md"), "utf8")).toBe("my notes");
  expect(await readdir(join(directory, "vendor"))).toEqual(["new.tgz"]);
  for (const [path, text] of [
    ["bot.js", "my strategy"],
    ["research/best.js", "best"],
    ["replays/keep.json.gz", "replay"],
    ["bots/custom.js", "custom"],
  ])
    expect(await readFile(join(directory, path!), "utf8")).toBe(text);
  const before = await readFile(join(directory, ".arena.json"));
  expect((await updateGame({ cwd: directory })).updated).toBe(false);
  expect(await readFile(join(directory, ".arena.json"))).toEqual(before);
});

test("failed downloads and unsafe managed paths leave the project intact", async () => {
  const f = await fixture();
  const { directory } = await initializeGame({
    gameId: "counter",
    directory: "bot",
    cwd: f.directory,
    server: f.server,
  });
  const original = await readFile(join(directory, "release.json"));
  const corrupt = archive(undefined, "latest");
  corrupt.metadata.archive.sha256 = "0".repeat(64);
  // Corruption in transit, rather than an endless 412 retry.
  corrupt.metadata.archive.bytes++;
  f.select(corrupt);
  await expect(updateGame({ cwd: directory })).rejects.toThrow("mismatch");
  f.select(archive(undefined, "latest"));
  await rm(join(directory, "SDK.md"));
  const outside = join(f.directory, "outside");
  await writeFile(outside, "keep");
  await symlink(outside, join(directory, "SDK.md"));
  await expect(updateGame({ cwd: directory })).rejects.toThrow("link");
  expect(await readFile(outside, "utf8")).toBe("keep");
  expect(await readFile(join(directory, "PROMPT.md"), "utf8")).toBe("PROMPT.md");
  expect(await readFile(join(directory, "release.json"))).toEqual(original);
  expect(await readdir(directory)).not.toContain(".arena-update.lock");
});

test("ZIP projects record their server on first update and concurrent updates are rejected", async () => {
  const f = await fixture();
  const { directory } = await initializeGame({
    gameId: "counter",
    directory: "bot",
    cwd: f.directory,
    server: f.server,
  });
  await rm(join(directory, ".arena.json"));
  await expect(updateGame({ cwd: directory })).rejects.toThrow("--server");
  expect((await updateGame({ cwd: directory, server: f.server })).updated).toBe(true);
  expect((await updateGame({ cwd: directory })).updated).toBe(false);
  await mkdir(join(directory, ".arena-update.lock"));
  await expect(updateGame({ cwd: directory })).rejects.toThrow("Another update");
});

test("cancellation during installation restores earlier replacements and the original project metadata", async () => {
  const f = await fixture();
  const { directory } = await initializeGame({
    gameId: "counter",
    directory: "bot",
    cwd: f.directory,
    server: f.server,
  });
  const manifest = await readFile(join(directory, "release.json"));
  const state = await readFile(join(directory, ".arena.json"));
  f.select(
    archive(undefined, "latest", (files) => {
      files["README.md"] = Buffer.from("new readme");
      files["SDK.md"] = Buffer.from("new sdk");
    }),
  );
  const controller = new AbortController();
  const throwIfAborted = controller.signal.throwIfAborted.bind(controller.signal);
  let checks = 0;
  vi.spyOn(controller.signal, "throwIfAborted").mockImplementation(() => {
    if (++checks === 3) controller.abort(new Error("cancelled during installation"));
    throwIfAborted();
  });
  await expect(updateGame({ cwd: directory, signal: controller.signal })).rejects.toThrow(
    "cancelled during installation",
  );
  expect(await readFile(join(directory, "PROMPT.md"), "utf8")).toBe("PROMPT.md");
  expect(await readFile(join(directory, "README.md"), "utf8")).toBe("README.md");
  expect(await readFile(join(directory, "SDK.md"), "utf8")).toBe("SDK.md");
  expect(await readFile(join(directory, "release.json"))).toEqual(manifest);
  expect(await readFile(join(directory, ".arena.json"))).toEqual(state);
  expect(await readdir(f.directory)).toEqual(["bot"]);
});

test.each(["README.md", "sdk/added.d.ts"])(
  "rollback preserves concurrent edits to %s and restores other files",
  async (name) => {
    const f = await fixture();
    const { directory } = await initializeGame({
      gameId: "counter",
      directory: "bot",
      cwd: f.directory,
      server: f.server,
    });
    const manifest = await readFile(join(directory, "release.json"));
    const state = await readFile(join(directory, ".arena.json"));
    f.select(
      archive(undefined, "latest", (files) => {
        files["README.md"] = Buffer.from("new readme");
        files[name] = Buffer.from("new platform file");
      }),
    );
    const controller = new AbortController();
    const throwIfAborted = controller.signal.throwIfAborted.bind(controller.signal);
    const path = join(directory, name);
    vi.spyOn(controller.signal, "throwIfAborted").mockImplementation(() => {
      if (existsSync(path) && readFileSync(path, "utf8") === "new platform file") {
        writeFileSync(path, "player edit during update");
        controller.abort(new Error("cancelled during installation"));
      }
      throwIfAborted();
    });

    const failure: unknown = await updateGame({ cwd: directory, signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw new Error("Expected a recovery error");
    expect(failure.errors).toEqual([
      expect.objectContaining({ message: "cancelled during installation" }),
      expect.objectContaining({ message: expect.stringContaining(`kept in place: ${name}`) }),
    ]);
    expect(await readFile(path, "utf8")).toBe("player edit during update");
    expect(await readFile(join(directory, "PROMPT.md"), "utf8")).toBe("PROMPT.md");
    expect(await readFile(join(directory, "release.json"))).toEqual(manifest);
    expect(await readFile(join(directory, ".arena.json"))).toEqual(state);
    expect(await readdir(directory)).not.toContain(".arena-update.lock");
    const journal = (await readdir(f.directory)).find((entry) =>
      entry.startsWith(".arena-update-"),
    );
    expect(journal).toBeDefined();
    expect(failure.message).toContain(join(f.directory, journal!));
    if (name === "README.md")
      expect(await readFile(join(f.directory, journal!, name), "utf8")).toBe("README.md");
    else expect(await readFile(join(directory, "README.md"), "utf8")).toBe("README.md");
  },
);
