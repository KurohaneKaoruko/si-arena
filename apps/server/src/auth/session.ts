import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sessions, users } from "@si-arena/db";
import type { Executor } from "@si-arena/db";
import { sendError } from "../http/errors";
import { createSessionToken, hashSessionToken, parseBearerAuthorization } from "./token";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionContext {
  sessionId: string;
  userId: string;
  username: string;
  official: boolean;
  passwordHash: string | null;
}

export async function createSession(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  const { token, tokenHash } = createSessionToken();
  await db
    .insert(sessions)
    .values({ tokenHash, userId, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) });
  return token;
}

export async function loadSession(
  db: Executor,
  request: FastifyRequest,
): Promise<SessionContext | null> {
  const token = parseBearerAuthorization(request.headers.authorization);
  if (token === null) return null;
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      username: users.normalizedUsername,
      official: users.official,
      passwordHash: users.passwordHash,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    username: row.username,
    official: row.official,
    passwordHash: row.passwordHash,
  };
}

/** Loads the session or replies with 401 and reports failure via null. */
export async function requireSession(
  db: Executor,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionContext | null> {
  const session = await loadSession(db, request);
  if (session === null) {
    sendError(reply, 401, "UNAUTHORIZED", "未登录或登录已过期");
    return null;
  }
  return session;
}
