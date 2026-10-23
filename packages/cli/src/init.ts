import { lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { GAME_ID_PATTERN } from "@si-arena/protocol";
import { DEFAULT_SERVER_URL } from "./metadata";
import { fetchDevkit, projectState } from "./devkit";

export async function initializeGame(options: {
  gameId: string;
  directory: string;
  server?: string;
  cwd?: string;
  signal?: AbortSignal;
}) {
  if (!GAME_ID_PATTERN.test(options.gameId)) throw new Error("Invalid game ID");
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
  try {
    const { metadata, files, server } = await fetchDevkit(
      options.gameId,
      options.server ?? DEFAULT_SERVER_URL,
      options.signal,
    );
    stage = await mkdtemp(join(dirname(target), ".arena-init-"));
    for (const [name, content] of Object.entries({
      ...files,
      ".arena.json": projectState(metadata, server),
    })) {
      options.signal?.throwIfAborted();
      const path = join(stage, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { flag: "wx" });
    }
    options.signal?.throwIfAborted();
    await rmdir(target);
    try {
      options.signal?.throwIfAborted();
      await rename(stage, target);
    } catch (error) {
      if (existing) await mkdir(target).catch(() => {});
      throw error;
    }
    stage = undefined;
    return { directory: target, release: metadata.game.release };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    if (created) await rmdir(target).catch(() => {});
  }
}
