import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  type CannotMatchReason,
  type GameCatalogEntry,
  type GameMeResponse,
} from "@si-arena/protocol";
import { requireSession } from "../auth/session";
import { gameEntries, users } from "../db/schema";
import { sendError } from "../http/errors";
import { parsePagination } from "../http/pagination";
import { gameCatalog } from "../games";
import { validatePlayerSource } from "./code";

const MAX_CODE_BYTES = Math.max(
  1024,
  ...[...gameCatalog.values()].map((entry) => entry.resolvedLimits.codeBytes),
);

function findGame(gameId: string): GameCatalogEntry | undefined {
  return gameCatalog.get(gameId);
}

function cannotMatchReason(
  entry: { botProtocolVersion: number; sourceBytes: number } | undefined,
  game: GameCatalogEntry,
): CannotMatchReason | null {
  if (entry === undefined) return "NO_CODE";
  if (entry.botProtocolVersion !== game.botProtocolVersion) return "PROTOCOL_MISMATCH";
  if (entry.sourceBytes > game.resolvedLimits.codeBytes) return "CODE_TOO_LARGE";
  return null;
}

export function gamesRoutes(db: NodePgDatabase): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    // Uploads must be valid UTF-8: the default plain-text parser silently replaces
    // invalid bytes with U+FFFD, which would store code that differs from what
    // the client actually sent.
    app.addContentTypeParser("text/plain", { parseAs: "buffer" }, (_request, body, done) => {
      try {
        done(null, new TextDecoder("utf-8", { fatal: true }).decode(body as Buffer));
      } catch {
        const error = new Error("Request body is not valid UTF-8 text") as Error & {
          statusCode: number;
        };
        error.statusCode = 400;
        done(error, undefined);
      }
    });

    app.get<{ Params: { gameId: string } }>("/api/games/:gameId/me", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const game = findGame(request.params.gameId);
      if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
      const session = await requireSession(db, request, reply);
      if (session === null) return reply;
      const rows = await db
        .select()
        .from(gameEntries)
        .where(and(eq(gameEntries.gameId, game.id), eq(gameEntries.userId, session.userId)))
        .limit(1);
      const entry = rows[0];
      const reason = cannotMatchReason(entry, game);
      const response: GameMeResponse = {
        entry: {
          rating: entry === undefined ? 1000 : Number(entry.rating),
          matchesPlayed: entry?.matchesPlayed ?? 0,
          wins: entry?.wins ?? 0,
          draws: entry?.draws ?? 0,
          losses: entry?.losses ?? 0,
        },
        code:
          entry === undefined
            ? null
            : {
                source: entry.sourceCode,
                sourceBytes: entry.sourceBytes,
                botProtocolVersion: entry.botProtocolVersion,
                updatedAt: entry.updatedAt.toISOString(),
              },
        canMatch: reason === null,
        cannotMatchReason: reason,
      };
      return response;
    });

    app.put<{ Params: { gameId: string } }>(
      "/api/games/:gameId/me/code",
      { bodyLimit: MAX_CODE_BYTES },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const game = findGame(request.params.gameId);
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        const session = await requireSession(db, request, reply);
        if (session === null) return reply;
        if (typeof request.body !== "string") {
          return sendError(reply, 400, "VALIDATION_ERROR", "请求体必须是 text/plain 的源码文本");
        }
        const source = request.body;
        // An empty program parses cleanly but can never provide an entrypoint,
        // so an empty upload is rejected at the request level.
        if (source.length === 0) {
          return sendError(reply, 400, "VALIDATION_ERROR", "源码文本不能为空");
        }
        if (Buffer.byteLength(source, "utf8") > game.resolvedLimits.codeBytes) {
          return sendError(reply, 413, "BODY_TOO_LARGE", "源码超过当前发行的体积上限");
        }
        const validation = await validatePlayerSource(source, game.resolvedLimits);
        if (!validation.ok && validation.reason === "BUSY") {
          return sendError(reply, 429, "RATE_LIMITED", "校验服务繁忙，请稍后再试", 1);
        }
        if (!validation.ok) {
          return sendError(
            reply,
            400,
            "CODE_INVALID",
            "源码校验未通过：语法错误或包含不支持的语法",
          );
        }
        const sourceBytes = Buffer.byteLength(source, "utf8");
        // The catalog is the single in-memory source of releases, so validating and
        // writing against the same entry already satisfies the release-freeze check.
        const rows = await db
          .insert(gameEntries)
          .values({
            gameId: game.id,
            userId: session.userId,
            sourceCode: source,
            sourceBytes,
            botProtocolVersion: game.botProtocolVersion,
          })
          .onConflictDoUpdate({
            target: [gameEntries.gameId, gameEntries.userId],
            set: {
              sourceCode: source,
              sourceBytes,
              botProtocolVersion: game.botProtocolVersion,
              updatedAt: new Date(),
            },
          })
          .returning({
            sourceBytes: gameEntries.sourceBytes,
            botProtocolVersion: gameEntries.botProtocolVersion,
            updatedAt: gameEntries.updatedAt,
          });
        const row = rows[0];
        if (row === undefined) throw new Error("code upsert returned no row");
        return {
          sourceBytes: row.sourceBytes,
          botProtocolVersion: row.botProtocolVersion,
          updatedAt: row.updatedAt.toISOString(),
        };
      },
    );

    app.get<{ Params: { gameId: string } }>(
      "/api/games/:gameId/leaderboard",
      async (request, reply) => {
        const game = findGame(request.params.gameId);
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        const { page, limit, offset } = parsePagination(request.url);
        const totals = await db
          .select({ count: sql<string>`count(*)` })
          .from(gameEntries)
          .where(eq(gameEntries.gameId, game.id));
        const rows = await db
          .select({
            rank: sql<string>`rank() over (order by ${gameEntries.rating} desc)`,
            userId: gameEntries.userId,
            username: users.normalizedUsername,
            official: users.official,
            rating: gameEntries.rating,
            matchesPlayed: gameEntries.matchesPlayed,
            wins: gameEntries.wins,
            draws: gameEntries.draws,
            losses: gameEntries.losses,
          })
          .from(gameEntries)
          .innerJoin(users, eq(gameEntries.userId, users.id))
          .where(eq(gameEntries.gameId, game.id))
          .orderBy(desc(gameEntries.rating), asc(gameEntries.userId))
          .limit(limit)
          .offset(offset);
        return {
          total: Number(totals[0]?.count ?? 0),
          page,
          limit,
          players: rows.map((row) => ({
            rank: Number(row.rank),
            userId: row.userId,
            username: row.username,
            official: row.official,
            rating: Number(row.rating),
            matchesPlayed: row.matchesPlayed,
            wins: row.wins,
            draws: row.draws,
            losses: row.losses,
          })),
        };
      },
    );
  };
}
