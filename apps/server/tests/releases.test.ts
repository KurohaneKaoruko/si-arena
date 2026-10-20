import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { buildApp } from "../src/app";
import { gameCatalog } from "../src/games";

test("development materials and immutable release downloads are public without a database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "si-arena-releases-"));
  const game = gameCatalog.get("paper")!;
  const bytes = Buffer.from("zip fixture");
  const releaseDir = join(directory, game.id, game.release);
  await mkdir(releaseDir, { recursive: true });
  const metadata = {
    formatVersion: 1,
    game,
    engineCompatibility: "arena-engine-v1",
    components: { "@si-arena/cli": "0.0.0" },
    runtime: { node: ">=26", pnpm: ">=12", nodeVersion: "26.11.1", packageManager: "pnpm@12.14.0" },
    sourceLockSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    archive: {
      url: `/api/games/paper/releases/${encodeURIComponent(game.release)}/download`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
  await writeFile(join(releaseDir, "metadata.json"), JSON.stringify(metadata));
  await writeFile(join(releaseDir, "devkit.zip"), bytes);
  const app = buildApp({ releasesDir: directory });
  try {
    const docs = await app.inject("/api/games/paper/development");
    expect(docs.statusCode).toBe(200);
    expect(docs.json().prompt).toContain("40×30");
    expect(docs.json().sdk).toContain("game.self.move");
    expect(docs.json().officialBot).toContain("export default");
    expect(docs.json().template).toContain("Memory");
    expect((await app.inject("/api/games/missing/development")).statusCode).toBe(404);
    const official = await app.inject("/api/games/paper/official-bot");
    expect(official.statusCode).toBe(200);
    expect(official.body).toBe(docs.json().officialBot);
    expect(official.headers["content-disposition"]).toContain("official.js");
    const manifest = await app.inject(
      `/api/games/paper/releases/${encodeURIComponent(game.release)}`,
    );
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json()).toEqual(metadata);
    expect(manifest.headers["cache-control"]).toContain("immutable");
    const alias = await app.inject("/api/games/paper/download");
    expect(alias.statusCode).toBe(302);
    expect(alias.headers.location).toBe(metadata.archive.url);
    expect(alias.headers["cache-control"]).toBe("no-store");
    const zip = await app.inject(metadata.archive.url);
    expect(zip.rawPayload).toEqual(bytes);
    expect(zip.headers["content-type"]).toBe("application/zip");
    expect(zip.headers["content-encoding"]).toBeUndefined();
    expect(zip.headers.etag).toContain(metadata.archive.sha256);
    expect((await app.inject("/api/games/paper/releases/unknown")).statusCode).toBe(404);
    expect((await app.inject("/api/games/paper/releases/..%2Fsecret/download")).statusCode).toBe(
      404,
    );
    await writeFile(join(releaseDir, "devkit.zip"), "wrong-size");
    expect((await app.inject(metadata.archive.url)).statusCode).toBe(500);
    await rm(join(releaseDir, "devkit.zip"));
    expect((await app.inject(metadata.archive.url)).statusCode).toBe(404);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
