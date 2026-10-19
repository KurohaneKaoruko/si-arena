import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { unzipSync } from "fflate";
import {
  DEVKIT_MAX_ARCHIVE_BYTES,
  DEVKIT_MAX_EXTRACTED_BYTES,
  DEVKIT_MAX_FILES,
  GAME_ID_PATTERN,
  GAME_RELEASE_PATTERN,
  isSafeDevkitPath,
  parseDevkitManifest,
  parseGameReleaseMetadata,
  stringifyJson,
  type GameReleaseMetadata,
} from "@si-arena/protocol";
import { DEFAULT_SERVER_URL } from "./metadata";

export async function initializeGame(options: {
  gameId: string;
  directory: string;
  server?: string;
  release?: string;
  cwd?: string;
  signal?: AbortSignal;
}): Promise<{ directory: string; release: string }> {
  if (!GAME_ID_PATTERN.test(options.gameId)) throw new Error("Invalid game ID");
  if (options.release !== undefined && !GAME_RELEASE_PATTERN.test(options.release))
    throw new Error("Invalid release ID");
  const base = serverBase(options.server ?? DEFAULT_SERVER_URL);
  const target = resolve(options.cwd ?? process.cwd(), options.directory);
  const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (
    existing &&
    (!existing.isDirectory() || existing.isSymbolicLink() || (await readdir(target)).length)
  )
    throw new Error(
      "Target directory must be absent or empty; existing files will not be overwritten",
    );
  await mkdir(dirname(target), { recursive: true });
  let created = false;
  if (!existing) {
    await mkdir(target);
    created = true;
  }
  let stage: string | undefined;
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(60_000),
  ]);
  try {
    let release = options.release;
    if (!release) {
      const raw: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await download(new URL(`games/${options.gameId}`, base), 1024 * 1024, signal),
        ),
      );
      if (
        !raw ||
        typeof raw !== "object" ||
        !("id" in raw) ||
        raw.id !== options.gameId ||
        !("release" in raw) ||
        typeof raw.release !== "string" ||
        !GAME_RELEASE_PATTERN.test(raw.release)
      )
        throw new Error("Invalid current game release");
      release = raw.release;
    }
    const metadataUrl = new URL(
      `games/${options.gameId}/releases/${encodeURIComponent(release)}`,
      base,
    );
    const metadata = parseGameReleaseMetadata(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await download(metadataUrl, 1024 * 1024, signal),
        ),
      ),
    );
    if (metadata.game.id !== options.gameId || metadata.game.release !== release)
      throw new Error("Release metadata does not match the requested game");
    const archiveUrl = new URL(metadata.archive.url, metadataUrl);
    if (
      archiveUrl.origin !== base.origin ||
      archiveUrl.username ||
      archiveUrl.password ||
      archiveUrl.hash
    )
      throw new Error("Development package must be downloaded from the selected server");
    const bytes = await download(archiveUrl, metadata.archive.bytes, signal);
    if (bytes.length !== metadata.archive.bytes || sha256(bytes) !== metadata.archive.sha256)
      throw new Error("Development package size or SHA-256 mismatch");
    const files = verifiedFiles(bytes, metadata);
    signal.throwIfAborted();
    stage = await mkdtemp(join(dirname(target), ".arena-init-"));
    for (const [name, content] of Object.entries(files)) {
      signal.throwIfAborted();
      const path = join(stage, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { flag: "wx" });
    }
    signal.throwIfAborted();
    // Windows cannot rename a directory over an existing empty directory.
    // rmdir also refuses any user files added while the download was in flight.
    await rmdir(target);
    try {
      signal.throwIfAborted();
      await rename(stage, target);
    } catch (error) {
      if (existing) await mkdir(target).catch(() => {});
      throw error;
    }
    stage = undefined;
    return { directory: target, release };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    if (created) await rmdir(target).catch(() => {});
  }
}

function serverBase(value: string): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("--server requires HTTPS; HTTP is allowed only for loopback development");
  url.pathname = `${url.pathname.replace(/\/$/, "").replace(/\/api$/, "")}/api/`;
  return url;
}
async function download(url: URL, max: number, signal: AbortSignal): Promise<Uint8Array> {
  if (max > DEVKIT_MAX_ARCHIVE_BYTES) throw new Error("Development package exceeds download limit");
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Download failed: HTTP ${response.status} (${url.pathname})`);
  }
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new Error("Download exceeds declared byte limit");
  }
  if (!response.body) throw new Error("Empty download");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > max) throw new Error("Download exceeds declared byte limit");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function verifiedFiles(
  bytes: Uint8Array,
  metadata: GameReleaseMetadata,
): Record<string, Uint8Array> {
  let total = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, {
    filter(file) {
      if (
        !isSafeDevkitPath(file.name) ||
        seen.has(file.name.toLowerCase()) ||
        seen.size >= DEVKIT_MAX_FILES + 1
      )
        throw new Error("Unsafe or duplicate development package path");
      seen.add(file.name.toLowerCase());
      total += file.originalSize;
      if (
        !Number.isSafeInteger(file.originalSize) ||
        file.originalSize < 0 ||
        total > DEVKIT_MAX_EXTRACTED_BYTES
      )
        throw new Error("Development package exceeds extraction limit");
      return true;
    },
  });
  const manifestBytes = files["release.json"];
  if (!manifestBytes || sha256(manifestBytes) !== metadata.manifestSha256)
    throw new Error("Development package manifest SHA-256 mismatch");
  const manifest = parseDevkitManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)),
  );
  const { files: entries, ...descriptor } = manifest;
  const expected = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => key !== "archive" && key !== "manifestSha256"),
  );
  if (
    stringifyJson(descriptor, { canonical: true }) !== stringifyJson(expected, { canonical: true })
  )
    throw new Error("Internal and external release metadata differ");
  if (Object.keys(files).length !== Object.keys(entries).length + 1)
    throw new Error("Unexpected development package files");
  for (const [name, entry] of Object.entries(entries)) {
    const file = files[name];
    if (!file || file.length !== entry.bytes || sha256(file) !== entry.sha256)
      throw new Error(`Development package checksum mismatch: ${name}`);
  }
  return files;
}
