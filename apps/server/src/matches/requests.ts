import { and, eq, inArray } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { GameCatalogEntry } from "@si-arena/protocol";
import { matches } from "@si-arena/db";
import { isUniqueViolation, uniqueConstraintName } from "../db/errors";
import { sendError } from "../http/errors";
import { buildMatchDetail } from "./detail";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idempotencyKeyOf(request: { headers: Record<string, unknown> }): string | null {
  const header = request.headers["idempotency-key"];
  if (typeof header !== "string" || header.length < 1 || header.length > 100) return null;
  return header;
}

/** Answers a unique violation on an initiated request; returns null when unrelated. */
export async function replyToDuplicate(
  db: NodePgDatabase,
  reply: FastifyReply,
  error: unknown,
  options: { initiatorId: string; idempotencyKey: string; game: GameCatalogEntry },
): Promise<FastifyReply | null> {
  if (!isUniqueViolation(error)) return null;
  const constraint = uniqueConstraintName(error);
  if (constraint === "matches_initiator_active_key") {
    const activeId = await findActiveMatchId(db, options.initiatorId, options.game.id);
    if (activeId === null) return null;
    return reply.status(409).send({
      code: "MATCH_ALREADY_PENDING",
      message: "已有未完成的主动比赛",
      matchId: activeId,
    });
  }
  if (constraint === "matches_initiator_idempotency_key") {
    const [existing] = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.initiatorId, options.initiatorId),
          eq(matches.idempotencyKey, options.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing === undefined) return null;
    if (existing.gameId !== options.game.id)
      return sendError(reply, 409, "IDEMPOTENCY_MISMATCH", "该幂等键已用于不同的请求参数");
    return reply.status(200).send(await buildMatchDetail(db, existing));
  }
  return null;
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
