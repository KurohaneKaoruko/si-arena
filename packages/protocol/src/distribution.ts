import type { GameCatalogEntry } from "./game";
import { stringifyJson } from "./json-data";
import { resolveResourceLimits } from "./resources";

export interface GameDevelopment {
  prompt: string;
  sdk: string;
  officialBot: string;
  template: string;
}
export interface DevkitDescriptor {
  formatVersion: 1;
  game: GameCatalogEntry;
  engineCompatibility: string;
  components: Record<string, string>;
  runtime: { node: string; pnpm: string; nodeVersion: string; packageManager: string };
  sourceLockSha256: string;
}
export interface DevkitManifest extends DevkitDescriptor {
  files: Record<string, { bytes: number; sha256: string }>;
}
export interface GameReleaseMetadata extends DevkitDescriptor {
  archive: { url: string; bytes: number; sha256: string };
  manifestSha256: string;
}
export const DEVKIT_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const DEVKIT_MAX_EXTRACTED_BYTES = 128 * 1024 * 1024;
export const DEVKIT_MAX_FILES = 2048;
export const GAME_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const GAME_RELEASE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._@+-]{0,127}$/;

function check(value: unknown): asserts value {
  if (!value) throw new TypeError("Invalid development package metadata");
}
function record(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function text(value: unknown): asserts value is string {
  check(typeof value === "string" && value.length > 0);
}
function integer(value: unknown): asserts value is number {
  check(Number.isSafeInteger(value) && (value as number) >= 0);
}
function digest(value: unknown) {
  check(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}
function descriptor(raw: unknown): void {
  const v = record(raw);
  check(v.formatVersion === 1);
  const game = record(v.game);
  check(typeof game.id === "string" && GAME_ID_PATTERN.test(game.id));
  check(typeof game.release === "string" && GAME_RELEASE_PATTERN.test(game.release));
  for (const key of ["name", "description"]) text(game[key]);
  for (const key of ["botProtocolVersion", "minPlayers", "maxPlayers", "maxTicks"]) {
    integer(game[key]);
    check(game[key] > 0);
  }
  record(game.config);
  stringifyJson(game.config);
  const limits = record(game.resolvedLimits);
  check(
    stringifyJson(resolveResourceLimits(limits), { canonical: true }) ===
      stringifyJson(limits, { canonical: true }),
  );
  text(v.engineCompatibility);
  const versions = record(v.components);
  check(Object.keys(versions).length > 0);
  for (const [name, version] of Object.entries(versions)) {
    check(/^@?[a-z0-9][a-z0-9._/-]*$/.test(name));
    text(version);
  }
  const runtime = record(v.runtime);
  for (const key of ["node", "pnpm", "nodeVersion", "packageManager"]) text(runtime[key]);
  check(
    runtime.node === ">=26" &&
      runtime.pnpm === ">=12" &&
      (runtime.packageManager as string).startsWith("pnpm@12."),
  );
  digest(v.sourceLockSha256);
}
export function isSafeDevkitPath(path: string): boolean {
  return (
    /^[a-zA-Z0-9.][a-zA-Z0-9._/-]*$/.test(path) &&
    path
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          !part.endsWith(".") &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}
export function parseDevkitManifest(raw: unknown): DevkitManifest {
  descriptor(raw);
  const files = record(record(raw).files);
  const names = Object.keys(files);
  check(names.length > 0 && names.length <= DEVKIT_MAX_FILES);
  let bytes = 0;
  const seen = new Set<string>();
  for (const [path, rawFile] of Object.entries(files)) {
    check(isSafeDevkitPath(path) && path !== "release.json" && !seen.has(path.toLowerCase()));
    seen.add(path.toLowerCase());
    const file = record(rawFile);
    integer(file.bytes);
    digest(file.sha256);
    bytes += file.bytes;
    check(bytes <= DEVKIT_MAX_EXTRACTED_BYTES);
  }
  for (const required of [
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
  ])
    check(Object.hasOwn(files, required));
  return raw as DevkitManifest;
}
export function parseGameReleaseMetadata(raw: unknown): GameReleaseMetadata {
  descriptor(raw);
  const v = record(raw);
  const archive = record(v.archive);
  text(archive.url);
  integer(archive.bytes);
  check(archive.bytes > 0 && archive.bytes <= DEVKIT_MAX_ARCHIVE_BYTES);
  digest(archive.sha256);
  digest(v.manifestSha256);
  return raw as GameReleaseMetadata;
}
export function parseGameDevelopment(raw: unknown): GameDevelopment {
  const value = record(raw);
  for (const key of ["prompt", "sdk", "officialBot", "template"]) text(value[key]);
  return raw as GameDevelopment;
}
