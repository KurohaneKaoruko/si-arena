import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { publishDevkit, readDevkit } from "@si-arena/development";
import { DEVKIT_REVISION_PATTERN, GAME_ID_PATTERN, GAME_RELEASE_PATTERN } from "@si-arena/protocol";

const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) throw new Error("Usage: seed-releases <source> <target>");
const source = resolve(sourceArg);
const target = resolve(targetArg);
if (source === target) throw new Error("Source and target must differ");

// Preserve legacy immutable bytes. Never replace files already served to clients.
async function copyLegacy(from: string, to: string) {
  try {
    await copyFile(from, to, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await readFile(from)).equals(await readFile(to)))
      throw new Error(`Cannot overwrite legacy release file: ${to}`, { cause: error });
  }
}

for (const game of await readdir(source, { withFileTypes: true })) {
  if (!game.isDirectory() || !GAME_ID_PATTERN.test(game.name)) continue;
  for (const release of await readdir(join(source, game.name), { withFileTypes: true })) {
    if (!release.isDirectory() || !GAME_RELEASE_PATTERN.test(release.name)) continue;
    const from = join(source, game.name, release.name);
    const to = join(target, game.name, release.name);
    const names = await readdir(from);
    if (names.includes("metadata.json")) {
      await mkdir(to, { recursive: true });
      await copyLegacy(join(from, "devkit.zip"), join(to, "devkit.zip"));
      await copyLegacy(join(from, "metadata.json"), join(to, "metadata.json"));
    }
    if (!names.includes("devkits")) continue;
    for (const revision of await readdir(join(from, "devkits"))) {
      if (!DEVKIT_REVISION_PATTERN.test(revision)) continue;
      const selected = await readDevkit(source, game.name, release.name, revision);
      if (!selected) throw new Error(`Missing revision ${revision}`);
      await publishDevkit(
        target,
        selected.metadata,
        await readFile(join(selected.directory, "devkit.zip")),
        { select: false },
      );
    }
    // Re-select the source's current revision after copying all complete revisions.
    const current = await readDevkit(source, game.name, release.name);
    if (!current) throw new Error("Missing current development package");
    if (names.includes("current.json"))
      await publishDevkit(
        target,
        current.metadata,
        await readFile(join(current.directory, "devkit.zip")),
      );
  }
}
