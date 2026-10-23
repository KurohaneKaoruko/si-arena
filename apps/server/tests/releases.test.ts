import { publishDevkit } from "@si-arena/development";
import { devkitDownloadPath, type GameReleaseMetadata } from "@si-arena/protocol";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { buildApp } from "../src/app";
import { gameCatalog } from "../src/games";

test("development materials and current package downloads are public without a database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "si-arena-releases-"));
  const game = gameCatalog.get("paper")!;
  const bytes = Buffer.from("zip fixture");
  const metadata: GameReleaseMetadata = {
    formatVersion: 1,
    game,
    engineCompatibility: "arena-engine-v1",
    components: { "@si-arena/cli": "0.0.0" },
    runtime: { node: ">=26", pnpm: ">=12", nodeVersion: "26.11.1", packageManager: "pnpm@12.14.0" },
    sourceLockSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    archive: {
      url: devkitDownloadPath(game.id),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
  await publishDevkit(directory, metadata, bytes);
  const app = buildApp({ releasesDir: directory });
  try {
    const docs = await app.inject("/api/games/paper/development");
    expect(docs.statusCode).toBe(200);
    expect(docs.json().prompt).toContain("30×30");
    expect(docs.json().sdk).toContain("game.self.move");
    expect(docs.json().officialBot).toContain("export default");
    expect(docs.json().template).toContain("Memory");
    expect((await app.inject("/api/games/missing/development")).statusCode).toBe(404);
    const official = await app.inject("/api/games/paper/official-bot");
    expect(official.statusCode).toBe(200);
    expect(official.body).toBe(docs.json().officialBot);
    expect(official.headers["content-disposition"]).toContain("official.js");
    const manifest = await app.inject("/api/games/paper/devkit");
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json()).toEqual(metadata);
    expect(manifest.headers["cache-control"]).toBe("no-store");
    const zip = await app.inject(metadata.archive.url);
    expect(zip.statusCode).toBe(200);
    expect(zip.rawPayload).toEqual(bytes);
    expect(zip.headers["content-type"]).toBe("application/zip");
    expect(zip.headers["content-encoding"]).toBeUndefined();
    expect(zip.headers["cache-control"]).toBe("no-store");
    const nextBytes = Buffer.from("latest package");
    const next = {
      ...metadata,
      manifestSha256: "c".repeat(64),
      archive: {
        ...metadata.archive,
        bytes: nextBytes.length,
        sha256: createHash("sha256").update(nextBytes).digest("hex"),
      },
    };
    const path = await publishDevkit(directory, next, nextBytes);
    expect((await app.inject("/api/games/paper/devkit")).json()).toEqual(next);
    expect((await app.inject(metadata.archive.url)).rawPayload).toEqual(nextBytes);
    expect(
      (
        await app.inject({
          url: metadata.archive.url,
          headers: { "if-match": `"${metadata.archive.sha256}"` },
        })
      ).statusCode,
    ).toBe(412);
    expect(
      (
        await app.inject({
          url: metadata.archive.url,
          headers: { "if-match": `"${next.archive.sha256}"` },
        })
      ).rawPayload,
    ).toEqual(nextBytes);
    for (const url of [
      `/api/games/paper/releases/${encodeURIComponent(game.release)}`,
      `/api/games/paper/releases/${encodeURIComponent(game.release)}/download`,
      `/api/games/paper/releases/${encodeURIComponent(game.release)}/devkits/${metadata.manifestSha256}/download`,
      "/api/games/unknown/download",
    ])
      expect((await app.inject(url)).statusCode).toBe(404);
    await writeFile(path, "wrong-size");
    expect((await app.inject(metadata.archive.url)).statusCode).toBe(500);
    await rm(path);
    expect((await app.inject(metadata.archive.url)).statusCode).toBe(404);
    await publishDevkit(
      directory,
      { ...next, game: { ...game, release: "paper@future" } },
      nextBytes,
    );
    expect((await app.inject("/api/games/paper/devkit")).statusCode).toBe(404);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
