import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { MatchDetail, MatchStatus, MatchSummary } from "@si-arena/protocol";
import { requireSession } from "../auth/session";
import { isUniqueViolation, uniqueConstraintName } from "../db/errors";
import { gameEntries, matchParticipants, matches, users } from "../db/schema";
import { sendError } from "../http/errors";
import { parsePagination } from "../http/pagination";
import { gameCatalog } from "../games";
import { selectOpponent } from "./opponent";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Seat aliases for the recent-opponent lookup: any match this user took part in
// (either seat), paired with the other participant.
const selfSeat = alias(matchParticipants, "self_seat");
const otherSeat = alias(matchParticipants, "other_seat");

type MatchRow = typeof matches.$inferSelect;

async function participantsOf(
  db: NodePgDatabase,
  matchId: string,
): Promise<MatchSummary["participants"]> {
  const rows = await db
    .select()
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, matchId))
    .orderBy(matchParticipants.slot);
  return rows.map((row) => ({
    userId: row.userId,
    username: row.nameSnapshot,
    official: row.officialSnapshot,
    slot: row.slot,
    ...(row.rank !== null ? { rank: row.rank } : {}),
    ...(row.ratingBefore !== null ? { ratingBefore: Number(row.ratingBefore) } : {}),
    ...(row.ratingAfter !== null ? { ratingAfter: Number(row.ratingAfter) } : {}),
  }));
}

async function buildMatchDetail(db: NodePgDatabase, row: MatchRow): Promise<MatchDetail> {
  const participants = await participantsOf(db, row.id);
  return {
    id: row.id,
    gameId: row.gameId,
    status: row.status as MatchStatus,
    createdAt: row.createdAt.toISOString(),
    participants,
    release: row.release,
    seed: row.seed,
    initiatorId: row.initiatorId,
    ...(row.result !== null ? { result: row.result } : {}),
    ...(row.failureReason !== null ? { failureReason: row.failureReason } : {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function idempotencyKeyOf(request: { headers: Record<string, unknown> }): string | null {
  const header = request.headers["idempotency-key"];
  if (typeof header !== "string" || header.length < 1 || header.length > 100) return null;
  return header;
}

async function findActiveMatchId(
  db: NodePgDatabase,
  initiatorId: string,
  gameId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        eq(matches.initiatorId, initiatorId),
        eq(matches.gameId, gameId),
        inArray(matches.status, ["pending", "running"]),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

export function matchesRoutes(db: NodePgDatabase): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.post<{ Params: { gameId: string } }>(
      "/api/games/:gameId/matches",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const game = gameCatalog.get(request.params.gameId);
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        const session = await requireSession(db, request, reply);
        if (session === null) return reply;
        const idempotencyKey = idempotencyKeyOf(request);
        if (idempotencyKey === null) {
          return sendError(
            reply,
            400,
            "VALIDATION_ERROR",
            "Idempotency-Key 请求头缺失或长度不合法",
          );
        }

        const existingRows = await db
          .select()
          .from(matches)
          .where(
            and(
              eq(matches.initiatorId, session.userId),
              eq(matches.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (existing !== undefined) {
          if (existing.gameId !== game.id) {
            return sendError(reply, 409, "IDEMPOTENCY_MISMATCH", "该幂等键已用于不同的请求参数");
          }
          return reply.status(200).send(await buildMatchDetail(db, existing));
        }

        const entryRows = await db
          .select()
          .from(gameEntries)
          .where(and(eq(gameEntries.gameId, game.id), eq(gameEntries.userId, session.userId)))
          .limit(1);
        const entry = entryRows[0];
        if (entry === undefined)
          return sendError(reply, 409, "NO_CODE", "尚未上传该游戏的选手代码");
        if (entry.botProtocolVersion !== game.botProtocolVersion) {
          return sendError(
            reply,
            409,
            "PROTOCOL_MISMATCH",
            "代码协议版本与当前发行不兼容，请重新上传",
          );
        }
        if (entry.sourceBytes > game.resolvedLimits.codeBytes) {
          return sendError(reply, 409, "CODE_TOO_LARGE", "代码体积超过当前发行上限，请重新上传");
        }

        try {
          const row = await db.transaction(async (tx) => {
            // Entries whose code cannot run under the frozen release must not be
            // selected as opponents (data-model-and-api.md "匹配前排除" rule).
            const candidateRows = await tx
              .select({ userId: gameEntries.userId, rating: gameEntries.rating })
              .from(gameEntries)
              .innerJoin(users, eq(gameEntries.userId, users.id))
              .where(
                and(
                  eq(gameEntries.gameId, game.id),
                  eq(users.official, false),
                  ne(gameEntries.userId, session.userId),
                  eq(gameEntries.botProtocolVersion, game.botProtocolVersion),
                  lte(gameEntries.sourceBytes, game.resolvedLimits.codeBytes),
                ),
              );
            const recentRows = await tx
              .select({ opponentId: otherSeat.userId })
              .from(matches)
              .innerJoin(selfSeat, eq(selfSeat.matchId, matches.id))
              .innerJoin(otherSeat, eq(otherSeat.matchId, matches.id))
              .where(
                and(
                  eq(matches.gameId, game.id),
                  eq(matches.status, "completed"),
                  eq(selfSeat.userId, session.userId),
                  ne(otherSeat.userId, session.userId),
                ),
              )
              .orderBy(desc(matches.createdAt))
              .limit(1);
            const selected = selectOpponent(
              Number(entry.rating),
              candidateRows.map((candidate) => ({
                userId: candidate.userId,
                rating: Number(candidate.rating),
              })),
              recentRows[0]?.opponentId ?? null,
            );

            let opponentId = selected;
            if (opponentId === null) {
              const officialRows = await tx
                .select({ userId: gameEntries.userId })
                .from(gameEntries)
                .innerJoin(users, eq(gameEntries.userId, users.id))
                .where(and(eq(gameEntries.gameId, game.id), eq(users.official, true)))
                .limit(1);
              const officialRow = officialRows[0];
              if (officialRow === undefined) {
                throw new Error(`Official account entry is missing for game ${game.id}`);
              }
              opponentId = officialRow.userId;
            }
            const opponentRows = await tx
              .select({
                id: users.id,
                username: users.normalizedUsername,
                official: users.official,
              })
              .from(users)
              .where(eq(users.id, opponentId))
              .limit(1);
            const opponent = opponentRows[0];
            if (opponent === undefined) throw new Error(`Opponent user ${opponentId} is missing`);

            const inserted = await tx
              .insert(matches)
              .values({
                gameId: game.id,
                release: game.release,
                config: game.config,
                resolvedLimits: game.resolvedLimits,
                botProtocolVersion: game.botProtocolVersion,
                seed: randomInt(0, 2 ** 32),
                initiatorId: session.userId,
                idempotencyKey,
                status: "pending",
              })
              .returning();
            const created = inserted[0];
            if (created === undefined) throw new Error("match insert returned no row");
            await tx.insert(matchParticipants).values([
              {
                matchId: created.id,
                userId: session.userId,
                slot: 0,
                nameSnapshot: session.username,
                officialSnapshot: session.official,
              },
              {
                matchId: created.id,
                userId: opponent.id,
                slot: 1,
                nameSnapshot: opponent.username,
                officialSnapshot: opponent.official,
              },
            ]);
            return created;
          });
          return reply.status(201).send(await buildMatchDetail(db, row));
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const constraint = uniqueConstraintName(error);
          if (constraint === "matches_initiator_active_key") {
            const activeId = await findActiveMatchId(db, session.userId, game.id);
            if (activeId !== null) {
              return reply.status(409).send({
                code: "MATCH_ALREADY_PENDING",
                message: "已有未完成的主动比赛",
                matchId: activeId,
              });
            }
            throw error;
          }
          if (constraint === "matches_initiator_idempotency_key") {
            const replayRows = await db
              .select()
              .from(matches)
              .where(
                and(
                  eq(matches.initiatorId, session.userId),
                  eq(matches.idempotencyKey, idempotencyKey),
                ),
              )
              .limit(1);
            const replay = replayRows[0];
            if (replay === undefined) throw error;
            if (replay.gameId !== game.id) {
              return sendError(reply, 409, "IDEMPOTENCY_MISMATCH", "该幂等键已用于不同的请求参数");
            }
            return reply.status(200).send(await buildMatchDetail(db, replay));
          }
          throw error;
        }
      },
    );

    app.get<{ Params: { gameId: string } }>(
      "/api/games/:gameId/me/matches",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const game = gameCatalog.get(request.params.gameId);
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        const session = await requireSession(db, request, reply);
        if (session === null) return reply;
        const { page, limit, offset } = parsePagination(request.url);
        const totals = await db
          .select({ count: sql<string>`count(*)` })
          .from(matches)
          .innerJoin(matchParticipants, eq(matchParticipants.matchId, matches.id))
          .where(and(eq(matches.gameId, game.id), eq(matchParticipants.userId, session.userId)));
        const rows = await db
          .select({ match: matches })
          .from(matches)
          .innerJoin(matchParticipants, eq(matchParticipants.matchId, matches.id))
          .where(and(eq(matches.gameId, game.id), eq(matchParticipants.userId, session.userId)))
          .orderBy(desc(matches.createdAt), desc(matches.id))
          .limit(limit)
          .offset(offset);
        const summaries = await Promise.all(rows.map((row) => buildMatchDetail(db, row.match)));
        return { total: Number(totals[0]?.count ?? 0), page, limit, matches: summaries };
      },
    );

    app.get<{ Params: { matchId: string } }>("/api/matches/:matchId", async (request, reply) => {
      const matchId = request.params.matchId;
      if (!UUID_PATTERN.test(matchId)) {
        return sendError(reply, 404, "MATCH_NOT_FOUND", "比赛不存在");
      }
      const rows = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
      const row = rows[0];
      if (row === undefined) return sendError(reply, 404, "MATCH_NOT_FOUND", "比赛不存在");
      return buildMatchDetail(db, row);
    });
  };
}
