import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEVKIT_REVISION_PATTERN,
  GAME_ID_PATTERN,
  GAME_RELEASE_PATTERN,
  devkitDownloadPath,
  parseGameReleaseMetadata,
  stringifyJson,
  type GameReleaseMetadata,
} from "@si-arena/protocol";

async function optionalText(path: string) {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

/** A mutable selector resolves once to an immutable content-addressed revision. */
export async function readDevkit(root: string, gameId: string, release: string, revision?: string) {
  if (!GAME_ID_PATTERN.test(gameId) || !GAME_RELEASE_PATTERN.test(release)) return null;
  if (revision !== undefined && !DEVKIT_REVISION_PATTERN.test(revision)) return null;
  const base = join(root, gameId, release);
  if (revision === undefined) {
    const current = await optionalText(join(base, "current.json"));
    if (current !== null) {
      const pointer: unknown = JSON.parse(current);
      if (
        !pointer ||
        typeof pointer !== "object" ||
        !("revision" in pointer) ||
        typeof pointer.revision !== "string" ||
        !DEVKIT_REVISION_PATTERN.test(pointer.revision)
      )
        throw new Error("Invalid development package selector");
      revision = pointer.revision;
    }
  }
  const directory = revision === undefined ? base : join(base, "devkits", revision);
  const raw = await optionalText(join(directory, "metadata.json"));
  if (raw === null) {
    // An init against a legacy store also reports a digest that can be pinned later.
    if (revision === undefined) return null;
    const legacyRaw = await optionalText(join(base, "metadata.json"));
    if (legacyRaw === null) return null;
    const legacy = parseGameReleaseMetadata(JSON.parse(legacyRaw));
    if (legacy.game.id !== gameId || legacy.game.release !== release)
      throw new Error("Development package identity mismatch");
    return legacy.manifestSha256 === revision ? { metadata: legacy, directory: base } : null;
  }
  const metadata = parseGameReleaseMetadata(JSON.parse(raw));
  if (
    metadata.game.id !== gameId ||
    metadata.game.release !== release ||
    (revision !== undefined &&
      (metadata.manifestSha256 !== revision ||
        metadata.archive.url !== devkitDownloadPath(gameId, release, revision)))
  )
    throw new Error("Development package identity mismatch");
  return { metadata, directory };
}

/** Never replaces a published revision. Only current.json changes, atomically and last. */
export async function publishDevkit(
  root: string,
  metadata: GameReleaseMetadata,
  zip: Uint8Array,
  options: { select?: boolean } = {},
) {
  parseGameReleaseMetadata(metadata);
  const { game, manifestSha256: revision } = metadata;
  if (
    metadata.archive.url !== devkitDownloadPath(game.id, game.release, revision) ||
    zip.length !== metadata.archive.bytes ||
    createHash("sha256").update(zip).digest("hex") !== metadata.archive.sha256
  )
    throw new Error("Development package archive mismatch");
  const previous = await readDevkit(root, game.id, game.release);
  if (
    previous &&
    (stringifyJson(previous.metadata.game, { canonical: true }) !==
      stringifyJson(game, { canonical: true }) ||
      previous.metadata.engineCompatibility !== metadata.engineCompatibility)
  )
    throw new Error("Game contract changed; increment the game release before publishing");
  const base = join(root, game.id, game.release);
  const parent = join(base, "devkits");
  await mkdir(parent, { recursive: true });
  const published = join(parent, revision);
  const candidate = await mkdtemp(join(parent, ".publish-"));
  try {
    await writeFile(join(candidate, "devkit.zip"), zip);
    await writeFile(join(candidate, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
    try {
      await rename(candidate, published);
    } catch (error) {
      const existing = await readDevkit(root, game.id, game.release, revision);
      if (
        !existing ||
        stringifyJson(existing.metadata, { canonical: true }) !==
          stringifyJson(metadata, { canonical: true })
      )
        throw error;
      const bytes = await readFile(join(published, "devkit.zip"));
      if (createHash("sha256").update(bytes).digest("hex") !== metadata.archive.sha256)
        throw new Error("Published development package is corrupt", { cause: error });
    }
    if (options.select === false) return join(published, "devkit.zip");
    const pointer = join(candidate, "current.json");
    // rename may have moved the candidate; recreate it for the atomic selector update.
    await mkdir(candidate, { recursive: true });
    await writeFile(pointer, JSON.stringify({ revision }) + "\n");
    await rename(pointer, join(base, "current.json"));
    return join(published, "devkit.zip");
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}
