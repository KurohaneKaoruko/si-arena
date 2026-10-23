import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "vitest";
import {
  devkitDownloadPath,
  resolveResourceLimits,
  type GameReleaseMetadata,
} from "@si-arena/protocol";
import { publishDevkit, readDevkit, readDevelopmentMaterials } from "../src";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function metadata(text: string): GameReleaseMetadata {
  const game = {
    id: "test",
    name: "Test",
    description: "Test",
    release: "test@1",
    botProtocolVersion: 1,
    minPlayers: 2,
    maxPlayers: 2,
    maxTicks: 1,
    config: {},
    resolvedLimits: resolveResourceLimits(),
  };
  return {
    formatVersion: 1,
    game,
    engineCompatibility: "arena-engine-v1",
    components: { "@si-arena/cli": "0.7.0" },
    runtime: { node: ">=26", pnpm: ">=12", nodeVersion: "26.11.1", packageManager: "pnpm@12.14.0" },
    sourceLockSha256: sha("lock"),
    manifestSha256: sha(text),
    archive: {
      url: devkitDownloadPath(game.id, game.release, sha(text)),
      bytes: Buffer.byteLength(text),
      sha256: sha(text),
    },
  };
}

test("revisions coexist without changing game identity; retries cannot overwrite a published revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "arena-devkit-store-"));
  try {
    const first = metadata("first");
    const second = metadata("second");
    const file = await publishDevkit(root, first, Buffer.from("first"));
    await publishDevkit(root, first, Buffer.from("first"));
    await publishDevkit(root, second, Buffer.from("second"));
    expect((await readDevkit(root, "test", "test@1"))?.metadata).toEqual(second);
    expect((await readDevkit(root, "test", "test@1", first.manifestSha256))?.metadata).toEqual(
      first,
    );
    expect(first.game).toEqual(second.game);
    const changedRules = { ...second, game: { ...second.game, maxTicks: 2 } };
    await expect(publishDevkit(root, changedRules, Buffer.from("second"))).rejects.toThrow(
      "Game contract changed",
    );
    const conflicting = {
      ...first,
      archive: { ...first.archive, bytes: 6, sha256: sha("forged") },
    };
    await expect(publishDevkit(root, conflicting, Buffer.from("forged"))).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("first");
    expect((await readDevkit(root, "test", "test@1"))?.metadata).toEqual(second);
    expect(await readDevkit(root, "test", "test@1", "../escape")).toBeNull();
    await writeFile(
      join(root, "test", "test@1", "current.json"),
      JSON.stringify({ revision: "../escape" }),
    );
    await expect(readDevkit(root, "test", "test@1")).rejects.toThrow("selector");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prompt assembly preserves game-specific content and rejects missing or duplicate insertion markers", async () => {
  const root = await mkdtemp(join(tmpdir(), "arena-prompt-"));
  const files = Object.fromEntries(
    ["prompt", "sdk", "template"].map((key) => [key, pathToFileURL(join(root, key))]),
  ) as { prompt: URL; sdk: URL; template: URL };
  try {
    await writeFile(files.sdk, "SDK");
    await writeFile(files.template, "bot");
    await writeFile(files.prompt, "# Game\n\n<!-- SI_ARENA_RESEARCH -->\n\n## Rules\n$&");
    const value = await readDevelopmentMaterials(files);
    expect(value.prompt).toContain("## 研究目标与预算");
    expect(value.prompt).toContain("## Rules\n$&");
    expect(value.prompt).not.toContain("<!-- SI_ARENA_RESEARCH -->");
    for (const text of ["none", "<!-- SI_ARENA_RESEARCH --><!-- SI_ARENA_RESEARCH -->"]) {
      await writeFile(files.prompt, text);
      await expect(readDevelopmentMaterials(files)).rejects.toThrow("exactly one");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
