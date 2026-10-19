import { open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import {
  GAME_ID_PATTERN,
  GAME_RELEASE_PATTERN,
  parseGameReleaseMetadata,
} from "@si-arena/protocol";
import { gameCatalog, registeredGames } from "../games";
import { sendError } from "../http/errors";

export const defaultReleasesDirectory = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
  "data/releases",
);
export function releaseRoutes(directory = defaultReleasesDirectory): FastifyPluginAsync {
  async function metadata(gameId: string, release: string) {
    if (!GAME_ID_PATTERN.test(gameId) || !GAME_RELEASE_PATTERN.test(release)) return null;
    const raw = await readFile(join(directory, gameId, release, "metadata.json"), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (raw === null) return null;
    const value = parseGameReleaseMetadata(JSON.parse(raw));
    if (value.game.id !== gameId || value.game.release !== release)
      throw new Error("Release metadata identity mismatch");
    return value;
  }
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
        const [prompt, sdk, template, officialBot] = await Promise.all([
          readFile(game.developmentFiles.prompt, "utf8"),
          readFile(game.developmentFiles.sdk, "utf8"),
          readFile(game.developmentFiles.template, "utf8"),
          readFile(game.officialBotUrl, "utf8"),
        ]);
        reply.header("Cache-Control", "no-store");
        return { prompt, sdk, template, officialBot };
      },
    );
    app.get<{ Params: { gameId: string; releaseId: string } }>(
      "/api/games/:gameId/releases/:releaseId",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const result = await metadata(request.params.gameId, request.params.releaseId);
        if (!result)
          return sendError(reply, 404, "RELEASE_NOT_FOUND", "游戏发行不存在或开发包尚未生成");
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
        return result;
      },
    );
    app.get<{ Params: { gameId: string } }>(
      "/api/games/:gameId/download",
      async (request, reply) => {
        const game = gameCatalog.get(request.params.gameId);
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        reply.header("Cache-Control", "no-store");
        return reply.redirect(
          `/api/games/${game.id}/releases/${encodeURIComponent(game.release)}/download`,
        );
      },
    );
    app.get<{ Params: { gameId: string; releaseId: string } }>(
      "/api/games/:gameId/releases/:releaseId/download",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const { gameId, releaseId } = request.params;
        const release = await metadata(gameId, releaseId);
        if (!release)
          return sendError(reply, 404, "RELEASE_NOT_FOUND", "游戏发行不存在或开发包尚未生成");
        const file = await open(join(directory, gameId, releaseId, "devkit.zip"), "r").catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          },
        );
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
              `attachment; filename="${gameId}-${releaseId}-devkit.zip"`,
            )
            .header("ETag", `"${release.archive.sha256}"`)
            .header("Cache-Control", "public, max-age=31536000, immutable")
            .send(file.createReadStream());
        } catch (error) {
          await file.close();
          throw error;
        }
      },
    );
  };
}
