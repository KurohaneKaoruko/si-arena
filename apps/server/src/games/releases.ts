import { readDevelopmentMaterials, readDevkit } from "@si-arena/development";
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { GameReleaseMetadata } from "@si-arena/protocol";
import { gameCatalog, registeredGames } from "../games";
import { sendError } from "../http/errors";

export const defaultReleasesDirectory = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
  "data/releases",
);
async function download(reply: FastifyReply, release: GameReleaseMetadata, path: string) {
  const file = await open(path, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!file) return sendError(reply, 404, "DEVKIT_NOT_FOUND", "开发包文件不存在");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== release.archive.bytes)
      throw new Error("Development package size differs from release metadata");
    return reply
      .header("Content-Type", "application/zip")
      .header("Content-Length", info.size)
      .header(
        "Content-Disposition",
        `attachment; filename="${release.game.id}-${release.game.release}-devkit.zip"`,
      )
      .header("ETag", `"${release.archive.sha256}"`)
      .header("Cache-Control", "no-store")
      .send(file.createReadStream());
  } catch (error) {
    await file.close();
    throw error;
  }
}
export function releaseRoutes(directory = defaultReleasesDirectory): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Params: { gameId: string } }>(
      "/api/games/:gameId/official-bot",
      async (request, reply) => {
        const game = registeredGames.find(
          (candidate) => candidate.entry.id === request.params.gameId,
        );
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        return reply
          .header("Content-Type", "text/plain; charset=utf-8")
          .header("Cache-Control", "no-store")
          .header("Content-Disposition", 'attachment; filename="official.js"')
          .send(await readFile(game.officialBotUrl, "utf8"));
      },
    );
    app.get<{ Params: { gameId: string } }>(
      "/api/games/:gameId/development",
      async (request, reply) => {
        const game = registeredGames.find(
          (candidate) => candidate.entry.id === request.params.gameId,
        );
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        const [materials, officialBot] = await Promise.all([
          readDevelopmentMaterials(game.developmentFiles),
          readFile(game.officialBotUrl, "utf8"),
        ]);
        reply.header("Cache-Control", "no-store");
        return { ...materials, officialBot };
      },
    );
    for (const endpoint of ["devkit", "download"]) {
      app.get<{ Params: { gameId: string } }>(
        `/api/games/:gameId/${endpoint}`,
        async (request, reply) => {
          reply.header("Cache-Control", "no-store");
          const game = gameCatalog.get(request.params.gameId);
          if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
          const selected = await readDevkit(directory, game.id);
          if (!selected || selected.metadata.game.release !== game.release)
            return sendError(reply, 404, "DEVKIT_NOT_FOUND", "当前游戏的开发包尚未生成");
          if (endpoint === "devkit") return selected.metadata;
          const expected = request.headers["if-match"];
          if (expected !== undefined && expected !== `"${selected.metadata.archive.sha256}"`)
            return sendError(reply, 412, "DEVKIT_CHANGED", "开发包已更新，请重新获取");
          return download(reply, selected.metadata, selected.path);
        },
      );
    }
  };
}
