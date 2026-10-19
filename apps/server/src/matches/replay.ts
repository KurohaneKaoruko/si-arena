import { open } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyReply } from "fastify";
import type { ReplayFileRef } from "@si-arena/db";
import { sendError } from "../http/errors";

/** Only a completed match's canonical public filename can be served. */
export async function sendReplay(
  reply: FastifyReply,
  root: string,
  matchId: string,
  ref: ReplayFileRef,
) {
  const fileName = `${matchId}.json.gz`;
  if (ref.fileName !== fileName) throw new Error("Unexpected replay file reference");
  const file = await open(join(root, fileName), "r").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!file) return sendError(reply, 404, "REPLAY_NOT_FOUND", "回放文件不存在");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== ref.bytes) throw new Error("Replay file metadata mismatch");
    return reply
      .header("Content-Type", "application/gzip")
      .header("Content-Length", info.size)
      .header("Content-Disposition", `attachment; filename="${fileName}"`)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("ETag", `"${ref.sha256}"`)
      .send(file.createReadStream());
  } catch (error) {
    await file.close();
    throw error;
  }
}
