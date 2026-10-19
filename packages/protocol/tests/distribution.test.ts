import { expect, test } from "vitest";
import { isSafeDevkitPath, parseGameDevelopment, parseGameReleaseMetadata } from "../src";

test.each([
  "../outside",
  "folder/../outside",
  "/absolute",
  "C:/windows",
  "a\\b",
  "a//b",
  "a/",
  "a.",
  "NUL.txt",
  "a/CON",
  "folder/COM1.txt",
])("rejects nonportable or escaping archive path %s", (path) => {
  expect(isSafeDevkitPath(path)).toBe(false);
});
test.each([
  "release.json",
  ".gitignore",
  "vendor/si-arena-cli-0.0.0.tgz",
  "sdk/index.d.ts",
  "LICENSES/quickjs.txt",
])("accepts portable archive path %s", (path) => {
  expect(isSafeDevkitPath(path)).toBe(true);
});
test("external development and release data require runtime validation", () => {
  expect(() => parseGameDevelopment({ prompt: 1 })).toThrow();
  expect(() => parseGameReleaseMetadata({ formatVersion: 2 })).toThrow();
  expect(() =>
    parseGameReleaseMetadata({ formatVersion: 1, game: { id: "../outside" } }),
  ).toThrow();
});
