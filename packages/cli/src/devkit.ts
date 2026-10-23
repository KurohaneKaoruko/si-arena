import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import {
  DEVKIT_MAX_ARCHIVE_BYTES,
  DEVKIT_MAX_EXTRACTED_BYTES,
  DEVKIT_MAX_FILES,
  devkitMetadataPath,
  devkitDownloadPath,
  isSafeDevkitPath,
  parseDevkitManifest,
  parseGameReleaseMetadata,
  stringifyJson,
  type GameReleaseMetadata,
} from "@si-arena/protocol";

class PackageChangedError extends Error {}

export function isPlatformFile(path: string) {
  return (
    [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "arena.mjs",
      "PROMPT.md",
      "SDK.md",
      "README.md",
      ".gitignore",
    ].includes(path) ||
    path === "bots/official.js" ||
    /^(vendor|sdk|dist|LICENSES)\//.test(path)
  );
}

export async function fetchDevkit(gameId: string, server: string, signal?: AbortSignal) {
  const base = serverBase(server);
  const downloadSignal = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(60_000),
  ]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const metadataUrl = new URL(devkitMetadataPath(gameId).slice(5), base);
    const metadata = parseGameReleaseMetadata(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await download(metadataUrl, 1024 * 1024, downloadSignal),
        ),
      ),
    );
    if (metadata.game.id !== gameId || metadata.archive.url !== devkitDownloadPath(gameId))
      throw new Error("Development package does not match the requested game or server");
    try {
      const bytes = await download(
        new URL(metadata.archive.url.slice(5), base),
        metadata.archive.bytes,
        downloadSignal,
        metadata.archive.sha256,
      );
      if (bytes.length !== metadata.archive.bytes || sha256(bytes) !== metadata.archive.sha256)
        throw new Error("Development package size or SHA-256 mismatch");
      const files = verifiedFiles(bytes, metadata);
      downloadSignal.throwIfAborted();
      return { metadata, files, server: base.href };
    } catch (error) {
      if (!(error instanceof PackageChangedError)) throw error;
    }
  }
  throw new Error("Development package changed repeatedly; try again");
}

export function projectState(metadata: GameReleaseMetadata, server: string) {
  return Buffer.from(
    JSON.stringify(
      {
        formatVersion: 1,
        gameId: metadata.game.id,
        server,
        manifestSha256: metadata.manifestSha256,
      },
      null,
      2,
    ) + "\n",
  );
}

export function serverBase(value: string): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "--server accepts only a plain HTTP(S) origin without credentials, query, or fragment",
    );
  url.pathname = `${url.pathname.replace(/\/$/, "").replace(/\/api$/, "")}/api/`;
  return url;
}
async function download(
  url: URL,
  max: number,
  signal: AbortSignal,
  expected?: string,
): Promise<Uint8Array> {
  if (max > DEVKIT_MAX_ARCHIVE_BYTES) throw new Error("Development package exceeds download limit");
  const response = await fetch(url, {
    signal,
    redirect: "error",
    cache: "no-store",
    ...(expected ? { headers: { "If-Match": `"${expected}"` } } : {}),
  });
  if (response.status === 412) {
    await response.body?.cancel();
    throw new PackageChangedError();
  }
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
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function verifiedFiles(
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
    if (name !== "bot.js" && !isPlatformFile(name))
      throw new Error(`Unexpected development package path: ${name}`);
    const file = files[name];
    if (!file || file.length !== entry.bytes || sha256(file) !== entry.sha256)
      throw new Error(`Development package checksum mismatch: ${name}`);
  }
  return files;
}
