import Fastify from "fastify";
import type { FastifyError } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { arenaRoutes } from "./arena/routes";
import { authRoutes } from "./auth/routes";
import { gamesRoutes } from "./games/routes";
import { matchesRoutes } from "./matches/routes";
import { gameCatalog } from "./games";
import { releaseRoutes } from "./games/releases";

export function buildApp(
  options: {
    logger?: boolean | { level: string };
    db?: NodePgDatabase;
    replaysDir?: string;
    releasesDir?: string;
  } = {},
) {
  const app = Fastify({ logger: options.logger ?? false });
  void app.register(releaseRoutes(options.releasesDir));
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      typeof error.statusCode === "number" && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "服务器内部错误" });
    }
    if (status === 413)
      return reply.status(413).send({ code: "BODY_TOO_LARGE", message: "请求体过大" });
    return reply.status(status).send({ code: "VALIDATION_ERROR", message: "请求格式不正确" });
  });
  app.get("/health", async () => ({ status: "ok", service: "si-arena-server" }));
  app.get("/api/games", async () => ({ games: [...gameCatalog.values()] }));
  app.get<{ Params: { gameId: string } }>("/api/games/:gameId", async (request, reply) => {
    const game = gameCatalog.get(request.params.gameId);
    if (!game) return reply.code(404).send({ code: "GAME_NOT_FOUND", message: "游戏不存在" });
    return game;
  });
  if (options.db) {
    void app.register(authRoutes(options.db), { prefix: "/api/auth" });
    void app.register(gamesRoutes(options.db));
    void app.register(matchesRoutes(options.db, options.replaysDir));
    void app.register(arenaRoutes(options.db));
  }
  return app;
}
