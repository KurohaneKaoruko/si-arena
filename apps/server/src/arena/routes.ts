import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  ArenaLineupEntry,
  ArenaSettings,
  ArenaStatusResponse,
  GameCatalogEntry,
} from "@si-arena/protocol";
import { gameEntries, matches, users } from "@si-arena/db";
import { loadSession, requireSession } from "../auth/session";
import { isUniqueViolation, uniqueConstraintName } from "../db/errors";
import { gameCatalog } from "../games";
import { sendError } from "../http/errors";
import {
  ENTRY_NOT_RUNNABLE_MESSAGES,
  entryNotRunnableReason,
  insertMatch,
  loadGameEntry,
  MatchRequestError,
  runnableEntry,
  type Seat,
} from "../matches/create";
import { buildMatchDetail } from "../matches/detail";
import { idempotencyKeyOf, replyToDuplicate } from "../matches/requests";

type Database = Pick<NodePgDatabase, "select">;

const tieBreakEntry = alias(gameEntries, "tie_break_entry");

interface LineupSeat extends Seat, ArenaLineupEntry {}

const lineupColumns = {
  userId: users.id,
  username: users.normalizedUsername,
  official: users.official,
  boss: users.boss,
  points: gameEntries.points,
  wins: gameEntries.wins,
  matchesPlayed: gameEntries.matchesPlayed,
  updatedAt: gameEntries.updatedAt,
};

type LineupRow = {
  userId: string;
  username: string;
  official: boolean;
  boss: boolean;
  points: number;
  wins: number;
  matchesPlayed: number;
  updatedAt: Date;
};

function toLineupSeat({ updatedAt, ...seat }: LineupRow): LineupSeat {
  return { ...seat, codeUpdatedAt: updatedAt.toISOString() };
}

/** The user's lineup seat when their code runs under the game's current release. */
async function lineupSeat(
  db: Database,
  game: GameCatalogEntry,
  userId: string,
): Promise<LineupSeat | undefined> {
  const rows = await db
    .select(lineupColumns)
    .from(gameEntries)
    .innerJoin(users, eq(gameEntries.userId, users.id))
    .where(and(runnableEntry(game), eq(users.id, userId)))
    .limit(1);
  return rows[0] === undefined ? undefined : toLineupSeat(rows[0]);
}

/**
 * Who enters a run started now (royale.md "入场"): the initiator takes one seat,
 * the remaining seats go to ordinary players with runnable code by points, then
 * the tie-break game's rating, then user id; the official bot takes one free
 * seat, unranked.
 */
async function arenaLineup(
  db: Database,
  game: GameCatalogEntry,
  arena: ArenaSettings,
  initiator?: LineupSeat,
): Promise<LineupSeat[]> {
  const conditions = [runnableEntry(game), eq(users.official, false), eq(users.boss, false)];
  if (initiator !== undefined) conditions.push(ne(gameEntries.userId, initiator.userId));
  const players = await db
    .select(lineupColumns)
    .from(gameEntries)
    .innerJoin(users, eq(gameEntries.userId, users.id))
    .leftJoin(
      tieBreakEntry,
      and(
        eq(tieBreakEntry.userId, gameEntries.userId),
        eq(tieBreakEntry.gameId, arena.tieBreakGameId ?? ""),
      ),
    )
    .where(and(...conditions))
    .orderBy(
      desc(gameEntries.points),
      sql`coalesce(${tieBreakEntry.rating}, 1000) desc`,
      asc(gameEntries.userId),
    )
    .limit(arena.seats - (initiator !== undefined ? 1 : 0));
  const seats =
    initiator !== undefined ? [initiator, ...players.map(toLineupSeat)] : players.map(toLineupSeat);
  if (seats.length < arena.seats) {
    const [official] = await db
      .select(lineupColumns)
      .from(gameEntries)
      .innerJoin(users, eq(gameEntries.userId, users.id))
      .where(and(runnableEntry(game), eq(users.official, true)))
      .limit(1);
    if (official !== undefined) seats.push(toLineupSeat(official));
  }
  return seats;
}

function lineupEntry(seat: LineupSeat): ArenaLineupEntry {
  return {
    userId: seat.userId,
    username: seat.username,
    official: seat.official,
    points: seat.points,
    wins: seat.wins,
    matchesPlayed: seat.matchesPlayed,
    codeUpdatedAt: seat.codeUpdatedAt,
  };
}

async function activeRun(db: Database, game: GameCatalogEntry) {
  const [row] = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.gameId, game.id),
        eq(matches.kind, "arena"),
        inArray(matches.status, ["pending", "running"]),
      ),
    )
    .limit(1);
  return row;
}

export function arenaRoutes(db: NodePgDatabase): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.get<{ Params: { gameId: string } }>("/api/games/:gameId/arena", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const game = gameCatalog.get(request.params.gameId);
      if (!game?.arena) return sendError(reply, 404, "ARENA_NOT_FOUND", "该游戏没有竞技场");
      // Logged-in viewers see the lineup of a run they would start; everyone
      // else the points-only board.
      const session = await loadSession(db, request);
      const initiator = session === null ? undefined : await lineupSeat(db, game, session.userId);
      const active = await activeRun(db, game);
      const recent = await db
        .select()
        .from(matches)
        .where(
          and(
            eq(matches.gameId, game.id),
            eq(matches.kind, "arena"),
            inArray(matches.status, ["completed", "failed"]),
          ),
        )
        .orderBy(desc(matches.createdAt), desc(matches.id))
        .limit(game.arena.keepMatches);
      const response: ArenaStatusResponse = {
        active: active === undefined ? null : await buildMatchDetail(db, active),
        lineup: (await arenaLineup(db, game, game.arena, initiator)).map(lineupEntry),
        recent: await Promise.all(recent.map((row) => buildMatchDetail(db, row))),
      };
      return response;
    });

    app.post<{ Params: { gameId: string } }>("/api/games/:gameId/arena", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const game = gameCatalog.get(request.params.gameId);
      const arena = game?.arena;
      if (!game || !arena) return sendError(reply, 404, "ARENA_NOT_FOUND", "该游戏没有竞技场");
      const session = await requireSession(db, request, reply);
      if (session === null) return reply;
      const idempotencyKey = idempotencyKeyOf(request);
      if (idempotencyKey === null)
        return sendError(reply, 400, "VALIDATION_ERROR", "Idempotency-Key 请求头缺失或长度不合法");
      try {
        const row = await db.transaction(async (tx) => {
          const problem = entryNotRunnableReason(
            await loadGameEntry(tx, game.id, session.userId),
            game,
          );
          if (problem !== null)
            throw new MatchRequestError(409, problem, ENTRY_NOT_RUNNABLE_MESSAGES[problem]);
          const initiator = await lineupSeat(tx, game, session.userId);
          if (initiator === undefined)
            throw new Error(`Initiator entry is not runnable for ${game.id}`);
          const lineup = await arenaLineup(tx, game, arena, initiator);
          if (lineup.length < game.minPlayers)
            throw new MatchRequestError(
              409,
              "ARENA_TOO_FEW_PLAYERS",
              `至少需要 ${game.minPlayers} 名可参赛选手才能开局`,
            );
          // Lineup is locked here; uploads after this point only affect later runs.
          return insertMatch(tx, game, {
            initiatorId: session.userId,
            idempotencyKey,
            kind: "arena",
            seats: lineup,
          });
        });
        return reply.status(201).send(await buildMatchDetail(db, row));
      } catch (error) {
        if (error instanceof MatchRequestError)
          return sendError(reply, error.status, error.code, error.message);
        if (
          isUniqueViolation(error) &&
          uniqueConstraintName(error) === "matches_arena_active_key"
        ) {
          const active = await activeRun(db, game);
          if (active !== undefined)
            return reply.status(409).send({
              code: "ARENA_BUSY",
              message: "竞技场正在运行，跑完后才能再开",
              matchId: active.id,
            });
        }
        const handled = await replyToDuplicate(db, reply, error, {
          initiatorId: session.userId,
          idempotencyKey,
          game,
        });
        if (handled !== null) return handled;
        throw error;
      }
    });
  };
}
