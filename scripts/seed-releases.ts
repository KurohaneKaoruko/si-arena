import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { publishDevkit, readDevkit } from "@si-arena/development";
import { GAME_ID_PATTERN } from "@si-arena/protocol";

const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) throw new Error("Usage: seed-releases <source> <target>");
const source = resolve(sourceArg);
const target = resolve(targetArg);
if (source === target) throw new Error("Source and target must differ");
for (const game of await readdir(source, { withFileTypes: true })) {
  if (!game.isDirectory() || !GAME_ID_PATTERN.test(game.name)) continue;
  const current = await readDevkit(source, game.name);
  if (!current) continue;
  await publishDevkit(target, current.metadata, await readFile(current.path));
}
