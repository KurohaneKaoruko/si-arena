import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { normalizeUsername, validatePassword, validateUsername } from "@si-arena/protocol";
import { sessions, users } from "../db/schema";
import { sendError } from "../http/errors";
import { dummyPasswordHash, hashPassword, passwordHashLimiter, verifyPassword } from "./password";
import { consumeAuthRateLimit } from "./rate-limit";
import { createSession, loadSession } from "./session";

const AUTH_BODY_LIMIT = 4096;

function readCredentials(body: unknown): { username: string; password: string } | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string") return null;
  return { username, password };
}

function readPasswordChange(body: unknown): { oldPassword: string; newPassword: string } | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const { oldPassword, newPassword } = body as Record<string, unknown>;
  if (typeof oldPassword !== "string" || typeof newPassword !== "string") return null;
  return { oldPassword, newPassword };
}

function toAuthUser(row: { id: string; normalizedUsername: string; official: boolean }) {
  return { id: row.id, username: row.normalizedUsername, official: row.official };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (code === "23505") return true;
  if (typeof cause === "object" && cause !== null) {
    return (cause as { code?: unknown }).code === "23505";
  }
  return false;
}

export function authRoutes(db: NodePgDatabase): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.addHook("onSend", async (_request, reply, payload) => {
      reply.header("Cache-Control", "no-store");
      return payload;
    });

    app.post("/register", { bodyLimit: AUTH_BODY_LIMIT }, async (request, reply) => {
      const decision = await consumeAuthRateLimit(db, "register", request.ip);
      if (!decision.allowed) {
        return sendError(
          reply,
          429,
          "RATE_LIMITED",
          "请求过于频繁，请稍后再试",
          decision.retryAfterSeconds,
        );
      }
      const body = readCredentials(request.body);
      if (body === null) return sendError(reply, 400, "VALIDATION_ERROR", "请求格式不正确");
      const usernameError = validateUsername(body.username);
      if (usernameError !== null) return sendError(reply, 400, "VALIDATION_ERROR", usernameError);
      const passwordError = validatePassword(body.password);
      if (passwordError !== null) return sendError(reply, 400, "VALIDATION_ERROR", passwordError);
      if (!passwordHashLimiter.acquire()) {
        return sendError(reply, 429, "RATE_LIMITED", "请求过于频繁，请稍后再试", 1);
      }
      try {
        const passwordHash = await hashPassword(body.password);
        const inserted = await db
          .insert(users)
          .values({ normalizedUsername: normalizeUsername(body.username), passwordHash })
          .returning({
            id: users.id,
            normalizedUsername: users.normalizedUsername,
            official: users.official,
          })
          .catch((error: unknown) => {
            if (isUniqueViolation(error)) return [];
            throw error;
          });
        const user = inserted[0];
        if (user === undefined) return sendError(reply, 409, "USERNAME_TAKEN", "用户名已被占用");
        const token = await createSession(db, user.id);
        return reply.status(201).send({ user: toAuthUser(user), token });
      } finally {
        passwordHashLimiter.release();
      }
    });

    app.post("/login", { bodyLimit: AUTH_BODY_LIMIT }, async (request, reply) => {
      const decision = await consumeAuthRateLimit(db, "login", request.ip);
      if (!decision.allowed) {
        return sendError(
          reply,
          429,
          "RATE_LIMITED",
          "请求过于频繁，请稍后再试",
          decision.retryAfterSeconds,
        );
      }
      const body = readCredentials(request.body);
      if (body === null) return sendError(reply, 400, "VALIDATION_ERROR", "请求格式不正确");
      if (!passwordHashLimiter.acquire()) {
        return sendError(reply, 429, "RATE_LIMITED", "请求过于频繁，请稍后再试", 1);
      }
      try {
        const rows = await db
          .select({
            id: users.id,
            normalizedUsername: users.normalizedUsername,
            official: users.official,
            passwordHash: users.passwordHash,
          })
          .from(users)
          .where(eq(users.normalizedUsername, normalizeUsername(body.username)))
          .limit(1);
        const user = rows[0];
        const storedHash = user?.passwordHash ?? dummyPasswordHash;
        const verified = await verifyPassword(body.password, storedHash);
        if (user === undefined || !verified) {
          return sendError(reply, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
        }
        const token = await db.transaction(async (tx) => {
          const locked = await tx
            .select({ passwordHash: users.passwordHash })
            .from(users)
            .where(eq(users.id, user.id))
            .for("update");
          if (locked[0]?.passwordHash !== storedHash) return null;
          return createSession(tx, user.id);
        });
        if (token === null) return sendError(reply, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
        return reply.status(200).send({ user: toAuthUser(user), token });
      } finally {
        passwordHashLimiter.release();
      }
    });

    app.get("/me", async (request, reply) => {
      const session = await loadSession(db, request);
      if (session === null) return sendError(reply, 401, "UNAUTHORIZED", "未登录或登录已过期");
      return {
        user: { id: session.userId, username: session.username, official: session.official },
      };
    });

    app.post("/logout", async (request, reply) => {
      const session = await loadSession(db, request);
      if (session === null) return sendError(reply, 401, "UNAUTHORIZED", "未登录或登录已过期");
      await db.delete(sessions).where(eq(sessions.id, session.sessionId));
      return reply.status(204).send();
    });

    app.put("/password", { bodyLimit: AUTH_BODY_LIMIT }, async (request, reply) => {
      const session = await loadSession(db, request);
      if (session === null) return sendError(reply, 401, "UNAUTHORIZED", "未登录或登录已过期");
      const body = readPasswordChange(request.body);
      if (body === null) return sendError(reply, 400, "VALIDATION_ERROR", "请求格式不正确");
      const passwordError = validatePassword(body.newPassword);
      if (passwordError !== null) return sendError(reply, 400, "VALIDATION_ERROR", passwordError);
      if (!passwordHashLimiter.acquire()) {
        return sendError(reply, 429, "RATE_LIMITED", "请求过于频繁，请稍后再试", 1);
      }
      try {
        const storedHash = session.passwordHash ?? dummyPasswordHash;
        const verified = await verifyPassword(body.oldPassword, storedHash);
        if (!verified) return sendError(reply, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
        const newPasswordHash = await hashPassword(body.newPassword);
        const changed = await db.transaction(async (tx) => {
          const locked = await tx
            .select({ passwordHash: users.passwordHash })
            .from(users)
            .where(eq(users.id, session.userId))
            .for("update");
          if (locked[0]?.passwordHash !== storedHash) return false;
          await tx
            .update(users)
            .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
            .where(eq(users.id, session.userId));
          await tx.delete(sessions).where(eq(sessions.userId, session.userId));
          return true;
        });
        if (!changed) return sendError(reply, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
        return reply.status(204).send();
      } finally {
        passwordHashLimiter.release();
      }
    });
  };
}
