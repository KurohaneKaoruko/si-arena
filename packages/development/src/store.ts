import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GAME_ID_PATTERN,
  devkitDownloadPath,
  parseGameReleaseMetadata,
  stringifyJson,
  type GameReleaseMetadata,
} from "@si-arena/protocol";

/** Only the current package is addressable; digest-named ZIPs keep in-flight reads stable. */
export async function readDevkit(root: string, gameId: string) {
  if (!GAME_ID_PATTERN.test(gameId)) return null;
  const base = join(root, gameId);
  const raw = await readFile(join(base, "current.json"), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (raw === null) return null;
  const metadata = parseGameReleaseMetadata(JSON.parse(raw));
  if (metadata.game.id !== gameId || metadata.archive.url !== devkitDownloadPath(gameId))
    throw new Error("Development package identity mismatch");
  return { metadata, path: join(base, `${metadata.archive.sha256}.zip`) };
}

/** Publish complete bytes first, then atomically select the current package. */
export async function publishDevkit(root: string, metadata: GameReleaseMetadata, zip: Uint8Array) {
  parseGameReleaseMetadata(metadata);
  const { game } = metadata;
  if (
    metadata.archive.url !== devkitDownloadPath(game.id) ||
    zip.length !== metadata.archive.bytes ||
    createHash("sha256").update(zip).digest("hex") !== metadata.archive.sha256
  )
    throw new Error("Development package archive mismatch");
  const previous = await readDevkit(root, game.id);
  if (
    previous?.metadata.game.release === game.release &&
    (stringifyJson(previous.metadata.game, { canonical: true }) !==
      stringifyJson(game, { canonical: true }) ||
      previous.metadata.engineCompatibility !== metadata.engineCompatibility)
  )
    throw new Error("Game contract changed; increment the game release before publishing");
  const base = join(root, game.id);
  await mkdir(base, { recursive: true });
  const candidate = await mkdtemp(join(base, ".publish-"));
  try {
    const path = join(base, `${metadata.archive.sha256}.zip`);
    await writeFile(join(candidate, "devkit.zip"), zip);
    await rename(join(candidate, "devkit.zip"), path);
    await writeFile(join(candidate, "current.json"), JSON.stringify(metadata, null, 2) + "\n");
    await rename(join(candidate, "current.json"), join(base, "current.json"));
    return path;
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}
