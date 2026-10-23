import { randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseDevkitManifest } from "@si-arena/protocol";
import { fetchDevkit, isPlatformFile, projectState, serverBase, sha256 } from "./devkit";

async function stat(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

/** Refuse links and directory/file conflicts before touching any managed file. */
async function checkPath(root: string, name: string) {
  const parts = name.split("/");
  let path = root;
  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index]!);
    const info = await stat(path);
    if (!info) return;
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw new Error(`Cannot update through a link or conflicting path: ${name}`);
  }
}

export async function updateGame(
  options: { cwd?: string; server?: string; signal?: AbortSignal } = {},
) {
  const target = resolve(options.cwd ?? process.cwd());
  const root = await lstat(target);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error("Expected a development project directory");
  const lock = join(target, ".arena-update.lock");
  await mkdir(lock).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST")
      throw new Error("Another update is active (.arena-update.lock exists)");
    throw error;
  });
  let stage: string | undefined;
  try {
    await checkPath(target, "release.json");
    await checkPath(target, ".arena.json");
    const manifestBytes = await readFile(join(target, "release.json"));
    const manifest = parseDevkitManifest(JSON.parse(manifestBytes.toString("utf8")));
    const stateBytes = await readFile(join(target, ".arena.json")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    let savedServer: string | undefined;
    if (stateBytes) {
      const state: unknown = JSON.parse(stateBytes.toString("utf8"));
      if (
        !state ||
        typeof state !== "object" ||
        !("formatVersion" in state) ||
        state.formatVersion !== 1 ||
        !("gameId" in state) ||
        state.gameId !== manifest.game.id ||
        !("server" in state) ||
        typeof state.server !== "string" ||
        !("manifestSha256" in state) ||
        state.manifestSha256 !== sha256(manifestBytes)
      )
        throw new Error("Invalid project state or modified release.json");
      savedServer = serverBase(state.server).href;
    }
    const server = options.server ?? savedServer;
    if (!server)
      throw new Error("This ZIP project has no server recorded; use arena update --server <url>");
    const next = await fetchDevkit(manifest.game.id, server, options.signal);
    if (sha256(manifestBytes) === next.metadata.manifestSha256 && savedServer === next.server)
      return { directory: target, release: manifest.game.release, updated: false };

    const files = Object.fromEntries(
      Object.entries(next.files).filter(([name]) => name !== "bot.js"),
    );
    files[".arena.json"] = projectState(next.metadata, next.server);
    const names = [
      ...new Set([...Object.keys(manifest.files).filter(isPlatformFile), ...Object.keys(files)]),
    ].toSorted();
    // Metadata is committed last; bot.js and arbitrary user files never enter this plan.
    const ordered = [
      ...names.filter((name) => name !== "release.json" && name !== ".arena.json"),
      "release.json",
      ".arena.json",
    ];
    const operations: Array<{
      name: string;
      before: Buffer | null;
      after?: Uint8Array;
      preserve: boolean;
    }> = [];
    for (const name of ordered) {
      await checkPath(target, name);
      const before = await readFile(join(target, name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      const after = files[name];
      if (before && after && before.equals(after)) continue;
      if (!before && !after) continue;
      const original = manifest.files[name];
      operations.push({
        name,
        before,
        ...(after ? { after } : {}),
        preserve:
          before !== null &&
          name !== "release.json" &&
          name !== ".arena.json" &&
          (!original || sha256(before) !== original.sha256),
      });
    }
    const preserve = operations.filter((operation) => operation.preserve);
    const backup = preserve.length ? join(target, ".arena-backups", randomUUID()) : undefined;
    if (backup) {
      const info = await stat(join(target, ".arena-backups"));
      if (info && (!info.isDirectory() || info.isSymbolicLink()))
        throw new Error("Unsafe .arena-backups directory");
    }
    stage = await mkdtemp(join(dirname(target), ".arena-update-"));
    const applied: Array<(typeof operations)[number] & { installed: boolean }> = [];
    try {
      for (const operation of operations) {
        options.signal?.throwIfAborted();
        const { name, before, after } = operation;
        await checkPath(target, name);
        const path = join(target, name);
        const current = await readFile(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (before === null ? current !== null : current === null || !before.equals(current))
          throw new Error(`Project file changed during update: ${name}`);
        if (before) {
          const saved = join(stage, name);
          await mkdir(dirname(saved), { recursive: true });
          await rename(path, saved);
        }
        const entry = { ...operation, installed: false };
        applied.push(entry);
        if (after) {
          await mkdir(dirname(path), { recursive: true });
          const file = await open(path, "wx");
          entry.installed = true;
          try {
            await file.writeFile(after);
          } finally {
            await file.close();
          }
        }
      }
      options.signal?.throwIfAborted();
      if (backup)
        for (const { name } of preserve) {
          const path = join(backup, name);
          await mkdir(dirname(path), { recursive: true });
          await copyFile(join(stage, name), path);
        }
    } catch (error) {
      // Restore original bytes if installation or backup fails. Keep the journal if recovery fails.
      const recoveryErrors: unknown[] = [];
      for (const { name, before, after, installed } of applied.toReversed()) {
        try {
          await checkPath(target, name);
          const path = join(target, name);
          if (installed) {
            const current = await readFile(path).catch((readError: NodeJS.ErrnoException) => {
              if (readError.code === "ENOENT") return null;
              throw readError;
            });
            if (current !== null && (!after || !current.equals(after)))
              throw new Error(`File changed during update recovery; kept in place: ${name}`, {
                cause: error,
              });
            await rm(path, { force: true });
          }
          if (before) {
            // Exclusive restoration cannot overwrite a file created by the user during recovery.
            await link(join(stage, name), path);
            await rm(join(stage, name));
          }
        } catch (recoveryError) {
          recoveryErrors.push(recoveryError);
        }
      }
      if (recoveryErrors.length) {
        const journal = stage;
        stage = undefined;
        throw new AggregateError(
          [error, ...recoveryErrors],
          `Update recovery failed; original files are in ${journal}`,
          { cause: error },
        );
      }
      throw error;
    }
    return {
      directory: target,
      release: next.metadata.game.release,
      updated: true,
      ...(backup ? { backup } : {}),
    };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
