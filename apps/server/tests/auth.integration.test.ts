import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { AUTH_RATE_LIMITS, subjectHashForIp } from "../src/auth/rate-limit";
import { buildApp } from "../src/app";
import { createDatabase } from "../src/db";
import { sweepExpiredAuthData } from "../src/db/cleanup";
import { ensureOfficialAccounts } from "../src/db/official";
import { authRateLimits, gameEntries, sessions, users } from "../src/db/schema";
import { registeredGames } from "../src/games";

/**
 * Requires a real PostgreSQL reachable through ARENA_TEST_DATABASE_URL (see README).
 * The suite creates and drops its own throwaway database; skipped when the variable is unset.
 */
const databaseUrl = process.env.ARENA_TEST_DATABASE_URL ?? "";
const dbTest = process.env.ARENA_TEST_DATABASE_URL ? test : test.skip;

let app: ReturnType<typeof buildApp>;
let database: ReturnType<typeof createDatabase>;
let admin: Client;
let testDbName = "";

let ipCounter = 0;
const uniqueIp = () => `10.99.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

interface CallOptions {
  body?: unknown;
  ip?: string;
  token?: string;
}

type InjectResponse = Awaited<ReturnType<ReturnType<typeof buildApp>["inject"]>>;

async function call(
  method: string,
  url: string,
  options: CallOptions = {},
): Promise<InjectResponse> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(options.body);
  }
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  return app.inject({
    method,
    url,
    headers,
    remoteAddress: options.ip ?? uniqueIp(),
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  testDbName = `si_arena_auth_test_${process.pid.toString(36)}_${Date.now().toString(36)}`;
  await admin.query(`CREATE DATABASE ${testDbName}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${testDbName}`;
  database = createDatabase(url.href);
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  app = buildApp({ db: database.db });
});

afterAll(async () => {
  // Each step is isolated so a failure above never prevents the database cleanup.
  if (app) await app.close().catch(() => undefined);
  if (database) await database.close().catch(() => undefined);
  if (admin) {
    if (testDbName !== "") {
      await admin.query(`DROP DATABASE ${testDbName} WITH (FORCE)`).catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
  }
});

dbTest("register, me, logout, and login form a working session lifecycle", async () => {
  const ip = uniqueIp();
  const reg = await call("POST", "/api/auth/register", {
    body: { username: "AdaL", password: "correct horse" },
    ip,
  });
  expect(reg.statusCode).toBe(201);
  const regBody = reg.json();
  expect(regBody.user).toMatchObject({ username: "adal", official: false });
  expect(typeof regBody.user.id).toBe("string");
  expect(typeof regBody.token).toBe("string");
  expect(reg.headers["cache-control"]).toContain("no-store");

  const me = await call("GET", "/api/auth/me", { ip, token: regBody.token });
  expect(me.statusCode).toBe(200);
  expect(me.json().user).toEqual(regBody.user);

  const sessionRows = await database.db
    .select({ expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.userId, regBody.user.id));
  expect(sessionRows).toHaveLength(1);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const remainingMs = (sessionRows[0]?.expiresAt.getTime() ?? 0) - Date.now();
  expect(remainingMs).toBeGreaterThan(sevenDaysMs - 60_000);
  expect(remainingMs).toBeLessThanOrEqual(sevenDaysMs);

  const login = await call("POST", "/api/auth/login", {
    body: { username: "ADAL", password: "correct horse" },
    ip: uniqueIp(),
  });
  expect(login.statusCode).toBe(200);
  const loginBody = login.json();
  expect(loginBody.user.id).toBe(regBody.user.id);
  expect(loginBody.token).not.toBe(regBody.token);

  const logout = await call("POST", "/api/auth/logout", { ip, token: regBody.token });
  expect(logout.statusCode).toBe(204);
  const meAfterLogout = await call("GET", "/api/auth/me", { ip, token: regBody.token });
  expect(meAfterLogout.statusCode).toBe(401);
  expect(meAfterLogout.json().code).toBe("UNAUTHORIZED");

  const meOtherSession = await call("GET", "/api/auth/me", { ip, token: loginBody.token });
  expect(meOtherSession.statusCode).toBe(200);
});

dbTest("duplicate normalized usernames are rejected", async () => {
  const first = await call("POST", "/api/auth/register", {
    body: { username: "Alice", password: "wonderland" },
    ip: uniqueIp(),
  });
  expect(first.statusCode).toBe(201);
  const second = await call("POST", "/api/auth/register", {
    body: { username: "alice", password: "other-pass" },
    ip: uniqueIp(),
  });
  expect(second.statusCode).toBe(409);
  expect(second.json().code).toBe("USERNAME_TAKEN");
});

dbTest("register rejects invalid bodies with 400", async () => {
  const shortName = await call("POST", "/api/auth/register", {
    body: { username: "x", password: "123456" },
  });
  expect(shortName.statusCode).toBe(400);
  expect(shortName.json().code).toBe("VALIDATION_ERROR");
  const reserved = await call("POST", "/api/auth/register", {
    body: { username: "Official", password: "123456" },
  });
  expect(reserved.statusCode).toBe(400);
  const shortPassword = await call("POST", "/api/auth/register", {
    body: { username: "bobby", password: "12345" },
  });
  expect(shortPassword.statusCode).toBe(400);
  const missingFields = await call("POST", "/api/auth/register", { body: { username: "bobby" } });
  expect(missingFields.statusCode).toBe(400);
});

dbTest("login failures are indistinguishable between unknown and wrong credentials", async () => {
  await call("POST", "/api/auth/register", {
    body: { username: "carol", password: "carol-pass" },
    ip: uniqueIp(),
  });
  const wrongPassword = await call("POST", "/api/auth/login", {
    body: { username: "carol", password: "wrong-pass" },
    ip: uniqueIp(),
  });
  const unknownUser = await call("POST", "/api/auth/login", {
    body: { username: "ghost", password: "wrong-pass" },
    ip: uniqueIp(),
  });
  expect(wrongPassword.statusCode).toBe(401);
  expect(unknownUser.statusCode).toBe(401);
  expect(wrongPassword.json().code).toBe("INVALID_CREDENTIALS");
  expect(unknownUser.json()).toEqual(wrongPassword.json());
});

dbTest("password change requires the old password and revokes every session", async () => {
  const reg = await call("POST", "/api/auth/register", {
    body: { username: "dave", password: "first-pass" },
    ip: uniqueIp(),
  });
  const secondLogin = await call("POST", "/api/auth/login", {
    body: { username: "dave", password: "first-pass" },
    ip: uniqueIp(),
  });
  const tokens = [reg.json().token, secondLogin.json().token];

  const wrongOld = await call("PUT", "/api/auth/password", {
    body: { oldPassword: "nope-nope", newPassword: "second-pass" },
    token: tokens[0],
    ip: uniqueIp(),
  });
  expect(wrongOld.statusCode).toBe(401);

  const change = await call("PUT", "/api/auth/password", {
    body: { oldPassword: "first-pass", newPassword: "second-pass" },
    token: tokens[0],
    ip: uniqueIp(),
  });
  expect(change.statusCode).toBe(204);
  for (const token of tokens) {
    const me = await call("GET", "/api/auth/me", { token, ip: uniqueIp() });
    expect(me.statusCode).toBe(401);
  }
  const reLogin = await call("POST", "/api/auth/login", {
    body: { username: "dave", password: "second-pass" },
    ip: uniqueIp(),
  });
  expect(reLogin.statusCode).toBe(200);
  const oldPassword = await call("POST", "/api/auth/login", {
    body: { username: "dave", password: "first-pass" },
    ip: uniqueIp(),
  });
  expect(oldPassword.statusCode).toBe(401);
});

dbTest("login is rate limited per IP with Retry-After", async () => {
  const ip = uniqueIp();
  await call("POST", "/api/auth/register", {
    body: { username: "erin", password: "erin-pass-1" },
    ip: uniqueIp(),
  });
  for (let i = 0; i < 10; i++) {
    const res = await call("POST", "/api/auth/login", {
      body: { username: "erin", password: `bad-pass-${i}` },
      ip,
    });
    expect(res.statusCode).toBe(401);
  }
  const blocked = await call("POST", "/api/auth/login", {
    body: { username: "erin", password: "bad-pass-99" },
    ip,
  });
  expect(blocked.statusCode).toBe(429);
  expect(blocked.json().code).toBe("RATE_LIMITED");
  const retryAfter = Number(blocked.headers["retry-after"]);
  expect(Number.isFinite(retryAfter)).toBe(true);
  const saturated = (
    await database.db
      .select({ windowStart: authRateLimits.windowStart, count: authRateLimits.count })
      .from(authRateLimits)
      .where(
        and(
          eq(authRateLimits.scope, "login"),
          eq(authRateLimits.subjectHash, subjectHashForIp(ip)),
        ),
      )
  ).filter((row) => row.count >= 11);
  expect(saturated).toHaveLength(1);
  const saturatedRow = saturated[0];
  if (!saturatedRow) throw new Error("expected a saturated rate-limit window");
  const windowMs = AUTH_RATE_LIMITS.login.windowMs;
  const remainingSeconds = Math.ceil(
    (saturatedRow.windowStart.getTime() + windowMs - Date.now()) / 1000,
  );
  expect(Math.abs(retryAfter - remainingSeconds)).toBeLessThanOrEqual(5);
});

dbTest("a stale rate-limit window does not block the current one", async () => {
  const ip = uniqueIp();
  const first = await call("POST", "/api/auth/login", {
    body: { username: "helen", password: "wrong-pass" },
    ip,
  });
  expect(first.statusCode).toBe(401);
  await database.db.insert(authRateLimits).values({
    scope: "login",
    subjectHash: subjectHashForIp(ip),
    windowStart: new Date(Date.now() - 10 * 60_000),
    count: 10,
  });
  const second = await call("POST", "/api/auth/login", {
    body: { username: "helen", password: "wrong-pass" },
    ip,
  });
  expect(second.statusCode).toBe(401);
});

dbTest("register is limited to three per hour per IP", async () => {
  const ip = uniqueIp();
  for (const name of ["frank-1", "frank-2", "frank-3"]) {
    const res = await call("POST", "/api/auth/register", {
      body: { username: name, password: "rank-pass" },
      ip,
    });
    expect(res.statusCode).toBe(201);
  }
  const fourth = await call("POST", "/api/auth/register", {
    body: { username: "frank-4", password: "rank-pass" },
    ip,
  });
  expect(fourth.statusCode).toBe(429);
});

dbTest("oversized auth bodies are rejected with 413", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress: uniqueIp(),
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ username: "big-body", password: "x".repeat(5000) }),
  });
  expect(res.statusCode).toBe(413);
  expect(res.json().code).toBe("BODY_TOO_LARGE");
});

dbTest("authenticated endpoints reject missing or malformed tokens", async () => {
  const me = await call("GET", "/api/auth/me");
  expect(me.statusCode).toBe(401);
  const logout = await call("POST", "/api/auth/logout");
  expect(logout.statusCode).toBe(401);
  const badScheme = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    remoteAddress: uniqueIp(),
    headers: { authorization: "Basic zzz" },
  });
  expect(badScheme.statusCode).toBe(401);
});

dbTest("official account initialization is idempotent and preserves rating", async () => {
  const paper = registeredGames.find((game) => game.entry.id === "paper");
  if (!paper) throw new Error("paper game is not registered");

  const first = await ensureOfficialAccounts(database.db, registeredGames);
  expect(first.games).toBe(registeredGames.length);

  const officialSource = await readFile(paper.officialBotUrl, "utf8");
  const entries = await database.db
    .select()
    .from(gameEntries)
    .where(eq(gameEntries.gameId, "paper"));
  expect(entries).toHaveLength(1);
  const entry = entries[0];
  expect(entry).toMatchObject({
    sourceCode: officialSource,
    botProtocolVersion: paper.entry.botProtocolVersion,
    rating: "1000.000000",
    matchesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
  });
  expect(entry?.sourceBytes).toBe(Buffer.byteLength(officialSource, "utf8"));

  await database.db
    .update(gameEntries)
    .set({ rating: "1234.500000", wins: 7 })
    .where(eq(gameEntries.gameId, "paper"));
  await ensureOfficialAccounts(database.db, registeredGames);
  const after = await database.db.select().from(gameEntries).where(eq(gameEntries.gameId, "paper"));
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ rating: "1234.500000", wins: 7, sourceCode: officialSource });

  const officialUsers = await database.db
    .select()
    .from(users)
    .where(eq(users.normalizedUsername, "official"));
  expect(officialUsers).toHaveLength(1);
  expect(officialUsers[0]).toMatchObject({ official: true, passwordHash: null });

  const login = await call("POST", "/api/auth/login", {
    body: { username: "official", password: "anything123" },
    ip: uniqueIp(),
  });
  expect(login.statusCode).toBe(401);
  expect(login.json().code).toBe("INVALID_CREDENTIALS");
});

dbTest("official bot larger than codeBytes fails initialization before writing", async () => {
  const paper = registeredGames.find((game) => game.entry.id === "paper");
  if (!paper) throw new Error("paper game is not registered");
  const oversized = {
    entry: {
      ...paper.entry,
      id: "overflow-game",
      resolvedLimits: { ...paper.entry.resolvedLimits, codeBytes: 8 },
    },
    officialBotUrl: paper.officialBotUrl,
  };
  await expect(ensureOfficialAccounts(database.db, [oversized])).rejects.toThrow(
    /exceeding the release limit/,
  );
  const rows = await database.db
    .select()
    .from(gameEntries)
    .where(eq(gameEntries.gameId, "overflow-game"));
  expect(rows).toHaveLength(0);
});

dbTest("sweeping removes expired sessions", async () => {
  const reg = await call("POST", "/api/auth/register", {
    body: { username: "grace", password: "grace-pass" },
    ip: uniqueIp(),
  });
  const userId = reg.json().user.id as string;
  const staleHash = `deadbeef`.repeat(8);
  await database.db.insert(sessions).values({
    tokenHash: staleHash,
    userId,
    expiresAt: new Date(Date.now() - 1000),
  });
  await sweepExpiredAuthData(database.db);
  const rows = await database.db.select().from(sessions).where(eq(sessions.tokenHash, staleHash));
  expect(rows).toHaveLength(0);
});
