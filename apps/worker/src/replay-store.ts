import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { isNotNull } from "drizzle-orm";
import { link, lstat, mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { matches } from "@si-arena/db";
import type { Executor, ReplayFileRef } from "@si-arena/db";

const CANDIDATE_MAX_AGE_MS = 60 * 60 * 1000;
const ORPHAN_FINAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Replay files under one root: `<matchId>.json.gz` is the public final name the
 * database references, `candidates/<matchId>-<executionId>.json.gz` holds the
 * immutable pre-settlement copy. Hard links publish without rewriting bytes, so
 * an existing final file is never overwritten.
 */
export class ReplayStore {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  get candidatesDir(): string {
    return join(this.root, "candidates");
  }

  candidatePath(matchId: string, executionId: string): string {
    return join(this.candidatesDir, `${matchId}-${executionId}.json.gz`);
  }

  finalPath(matchId: string): string {
    return join(this.root, `${matchId}.json.gz`);
  }

  async prepare(): Promise<void> {
    await mkdir(this.candidatesDir, { recursive: true });
  }

  /** File-level metadata for the database reference; measured on the candidate. */
  async inspect(candidatePath: string, matchId: string): Promise<ReplayFileRef> {
    const info = await stat(candidatePath);
    if (!info.isFile()) throw new Error(`Replay candidate is missing: ${candidatePath}`);
    return {
      fileName: `${matchId}.json.gz`,
      formatVersion: 1,
      bytes: info.size,
      sha256: await sha256File(candidatePath),
    };
  }

  /**
   * Links the candidate to its public name. Call inside the settlement
   * transaction after execution rights are confirmed. A prior link to the same
   * immutable candidate is an idempotent retry; every other target is rejected.
   */
  async publish(candidatePath: string, matchId: string): Promise<void> {
    const target = this.finalPath(matchId);
    await mkdir(this.root, { recursive: true });
    try {
      await link(candidatePath, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const [candidate, existing] = await Promise.all([
        lstat(candidatePath, { bigint: true }),
        lstat(target, { bigint: true }),
      ]);
      if (
        !candidate.isFile() ||
        !existing.isFile() ||
        candidate.dev !== existing.dev ||
        candidate.ino !== existing.ino
      ) {
        throw error;
      }
    }
    if (process.platform !== "win32") {
      const directory = await open(this.root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  }

  /** Removes the public replay of a match whose row was deleted. */
  async remove(matchId: string): Promise<void> {
    await rm(this.finalPath(matchId), { force: true });
  }

  /**
   * Deletes stale candidates and orphaned finals. Creating matches or touching
   * referenced files is out of scope by design.
   */
  async cleanup(db: Executor, now = Date.now()): Promise<{ candidates: number; finals: number }> {
    let removedCandidates = 0;
    let removedFinals = 0;
    const referenced = new Set(
      (
        await db
          .select({ fileName: matches.replayFile })
          .from(matches)
          .where(isNotNull(matches.replayFile))
      )
        .map((row) => row.fileName?.fileName)
        .filter((fileName): fileName is string => fileName !== undefined),
    );
    for (const entry of await readdir(this.candidatesDir).catch(() => [])) {
      const path = join(this.candidatesDir, entry);
      const info = await stat(path).catch(() => null);
      if (info === null || !info.isFile()) continue;
      if (now - info.mtimeMs > CANDIDATE_MAX_AGE_MS) {
        await rm(path, { force: true });
        removedCandidates++;
      }
    }
    for (const entry of await readdir(this.root).catch(() => [])) {
      if (!entry.endsWith(".json.gz")) continue;
      const path = join(this.root, entry);
      const info = await stat(path).catch(() => null);
      if (info === null || !info.isFile()) continue;
      if (now - info.mtimeMs > ORPHAN_FINAL_MAX_AGE_MS && !referenced.has(entry)) {
        await rm(path, { force: true });
        removedFinals++;
      }
    }
    return { candidates: removedCandidates, finals: removedFinals };
  }
}
