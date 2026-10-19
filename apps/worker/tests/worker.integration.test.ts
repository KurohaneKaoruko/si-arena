import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import {
  createDatabase,
  gameEntries,
  matchParticipants,
  matches,
  migrationsFolder,
  users,
} from "@si-arena/db";
import { paperCatalogEntry } from "@si-arena/game-paper";
import { officialBotUrl, paperGame } from "@si-arena/game-paper/game";
import { replayMatch } from "@si-arena/engine";
import { readReplayFile } from "@si-arena/engine/node";
import { claimNextMatch, failExpiredLeases } from "../src/claim";
import { runClaimedMatch, type WorkerJobContext } from "../src/execute";
import { claimableReleases } from "../src/games";
import { ReplayStore } from "../src/replay-store";
import { settleMatch } from "../src/settle";

/**
 * Requires a real PostgreSQL reachable through ARENA_TEST_DATABASE_URL (see README).
 * The suite creates and drops its own throwaway database; skipped when unset.
 */
const databaseUrl = process.env.ARENA_TEST_DATABASE_URL ?? "";
const dbTest = process.env.ARENA_TEST_DATABASE_URL ? test : test.skip;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let database: ReturnType<typeof createDatabase>;
let admin: Client;
let testDbName = "";
let store: ReplayStore;
let replaysRoot: string;
let ctx: WorkerJobContext;
let officialSource: string;
let userCounter = 0;
let matchCounter = 0;

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function createUser() {
  const username = `wk${userCounter++}`;
  const rows = await database.db
    .insert(users)
    .values({ normalizedUsername: username, official: false })
    .returning();
  const user = rows[0]!;
  return { id: user.id, username };
}

async function createEntry(userId: string, overrides: { botProtocolVersion?: number } = {}) {
  await database.db.insert(gameEntries).values({
    gameId: paperCatalogEntry.id,
    userId,
    sourceCode: officialSource,
    sourceBytes: Buffer.byteLength(officialSource, "utf8"),
    botProtocolVersion: overrides.botProtocolVersion ?? paperCatalogEntry.botProtocolVersion,
  });
}

async function createPendingMatch(
  a: { id: string; username: string },
  b: { id: string; username: string },
  overrides: { release?: string } = {},
) {
  const rows = await database.db
    .insert(matches)
    .values({
      gameId: paperCatalogEntry.id,
      release: overrides.release ?? paperCatalogEntry.release,
      config: paperCatalogEntry.config,
      resolvedLimits: paperCatalogEntry.resolvedLimits,
      botProtocolVersion: paperCatalogEntry.botProtocolVersion,
      seed: 12345,
      initiatorId: a.id,
      idempotencyKey: `worker-test-${matchCounter++}`,
      status: "pending",
    })
    .returning();
  const match = rows[0]!;
  await database.db.insert(matchParticipants).values([
    {
      matchId: match.id,
      userId: a.id,
      slot: 0,
      nameSnapshot: a.username,
      officialSnapshot: false,
    },
    {
      matchId: match.id,
      userId: b.id,
      slot: 1,
      nameSnapshot: b.username,
      officialSnapshot: false,
    },
  ]);
  return match;
}

async function matchRow(matchId: string) {
  const rows = await database.db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  return rows[0]!;
}

beforeAll(async () => {
  admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  testDbName = `si_arena_wk_test_${process.pid.toString(36)}_${Date.now().toString(36)}`;
  await admin.query(`CREATE DATABASE ${testDbName}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${testDbName}`;
  database = createDatabase(url.href);
  await migrate(database.db, { migrationsFolder });
  officialSource = await readFile(officialBotUrl, "utf8");
  replaysRoot = await mkdtemp(join(tmpdir(), "arena-worker-replays-"));
  store = new ReplayStore(replaysRoot);
  await store.prepare();
  ctx = { db: database.db, store, isolation: { kind: "local" } };
});

afterAll(async () => {
  // Each step is isolated so a failure above never prevents the database cleanup.
  if (replaysRoot) await rm(replaysRoot, { recursive: true, force: true }).catch(() => undefined);
  if (database) await database.close().catch(() => undefined);
  if (admin) {
    if (testDbName !== "") {
      await admin.query(`DROP DATABASE ${testDbName} WITH (FORCE)`).catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
  }
});

dbTest(
  "a claimed match executes, publishes its replay, and settles ratings",
  { timeout: 120_000 },
  async () => {
    const first = await createUser();
    const second = await createUser();
    await createEntry(first.id);
    await createEntry(second.id);
    const pending = await createPendingMatch(first, second);

    const claim = await claimNextMatch(database.db, claimableReleases());
    expect(claim).not.toBeNull();
    expect(claim!.id).toBe(pending.id);
    expect(claim!.status).toBe("running");
    expect(claim!.executionId).toMatch(UUID_PATTERN);
    expect(claim!.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());

    await runClaimedMatch(ctx, claim!);

    const row = await matchRow(pending.id);
    expect(row.status).toBe("completed");
    expect(row.failureReason).toBeNull();
    expect(row.leaseExpiresAt).toBeNull();
    const result = row.result!;
    expect(result.players).toHaveLength(2);
    const rankByUser = new Map(result.players.map((player) => [player.id, player.rank]));

    // The public file matches the stored reference exactly and replays cleanly.
    const finalPath = store.finalPath(pending.id);
    const info = await stat(finalPath);
    expect(row.replayFile).toMatchObject({
      fileName: `${pending.id}.json.gz`,
      formatVersion: 1,
      bytes: info.size,
    });
    expect(await sha256File(finalPath)).toBe(row.replayFile!.sha256);
    const raw = await readReplayFile(finalPath);
    const summary = await replayMatch(raw, paperGame, {});
    expect(summary.result).toEqual(result);
    for (const tick of (raw as { ticks: Array<{ logs?: unknown }> }).ticks) {
      expect(tick.logs).toBeUndefined();
    }

    // Settlement wrote both sides with zero-sum Elo from the starting 1000.
    const seats = await database.db
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.matchId, pending.id))
      .orderBy(matchParticipants.slot);
    expect(seats).toHaveLength(2);
    const rankA = rankByUser.get(seats[0]!.userId)!;
    const rankB = rankByUser.get(seats[1]!.userId)!;
    const scoreA = rankA < rankB ? 1 : rankA === rankB ? 0.5 : 0;
    const entryRows = await database.db
      .select()
      .from(gameEntries)
      .where(eq(gameEntries.gameId, paperCatalogEntry.id));
    const entryByUser = new Map(entryRows.map((entry) => [entry.userId, entry]));
    let ratingSum = 0;
    for (const [index, seat] of seats.entries()) {
      const score = index === 0 ? scoreA : 1 - scoreA;
      expect(seat.rank).toBe(rankByUser.get(seat.userId));
      expect(seat.ratingBefore).toBe("1000.000000");
      const expected = score === 1 ? "1016.000000" : score === 0.5 ? "1000.000000" : "984.000000";
      expect(seat.ratingAfter).toBe(expected);
      const entry = entryByUser.get(seat.userId)!;
      expect(entry.matchesPlayed).toBe(1);
      expect(entry.wins).toBe(score === 1 ? 1 : 0);
      expect(entry.draws).toBe(score === 0.5 ? 1 : 0);
      expect(entry.losses).toBe(score === 0 ? 1 : 0);
      expect(entry.rating).toBe(expected);
      ratingSum += Number(entry.rating);
    }
    expect(ratingSum).toBe(2000);

    // Settling again is refused and changes nothing.
    const again = await settleMatch(database.db, store, {
      matchId: pending.id,
      executionId: claim!.executionId,
      result,
      replayFile: row.replayFile!,
      candidatePath: store.candidatePath(pending.id, claim!.executionId),
    });
    expect(again).toBe("refused");
    const unchanged = await matchRow(pending.id);
    expect(unchanged.status).toBe("completed");
    expect(unchanged.updatedAt).toEqual(row.updatedAt);
  },
);

dbTest("entries that drifted from the frozen release fail before execution", async () => {
  const initiator = await createUser();
  const stale = await createUser();
  await createEntry(initiator.id);
  await createEntry(stale.id, { botProtocolVersion: paperCatalogEntry.botProtocolVersion + 1 });
  const pending = await createPendingMatch(initiator, stale);

  const claim = await claimNextMatch(database.db, claimableReleases());
  expect(claim!.id).toBe(pending.id);
  await runClaimedMatch(ctx, claim!);

  const row = await matchRow(pending.id);
  expect(row.status).toBe("failed");
  expect(row.failureReason).toBe("ENTRY_CHANGED_BEFORE_START");
  expect(row.replayFile).toBeNull();
  await expect(stat(store.finalPath(pending.id))).rejects.toThrow();
  const entries = await database.db
    .select()
    .from(gameEntries)
    .where(eq(gameEntries.userId, stale.id));
  expect(entries[0]!.matchesPlayed).toBe(0);
  expect(entries[0]!.rating).toBe("1000.000000");
});

dbTest("settlement is refused without matching execution rights", async () => {
  const first = await createUser();
  const second = await createUser();
  await createEntry(first.id);
  await createEntry(second.id);
  const pending = await createPendingMatch(first, second);
  const claim = await claimNextMatch(database.db, claimableReleases());
  expect(claim!.id).toBe(pending.id);

  // A different worker steals the execution id before this one settles.
  await database.db
    .update(matches)
    .set({ executionId: "00000000-0000-4000-8000-000000000001" })
    .where(eq(matches.id, pending.id));

  const outcome = await settleMatch(database.db, store, {
    matchId: pending.id,
    executionId: claim!.executionId,
    result: {
      reason: "ticks-exhausted",
      completedTicks: 1,
      players: [
        { id: first.id, rank: 1, score: 1 },
        { id: second.id, rank: 2, score: 0 },
      ],
    },
    replayFile: {
      fileName: `${pending.id}.json.gz`,
      formatVersion: 1,
      bytes: 1,
      sha256: "0".repeat(64),
    },
    candidatePath: store.candidatePath(pending.id, claim!.executionId),
  });
  expect(outcome).toBe("refused");
  const row = await matchRow(pending.id);
  expect(row.status).toBe("running");
  expect(row.replayFile).toBeNull();
  const entries = await database.db
    .select()
    .from(gameEntries)
    .where(eq(gameEntries.userId, first.id));
  expect(entries[0]!.matchesPlayed).toBe(0);
});

dbTest("expired leases are failed by the sweep and claims skip unknown releases", async () => {
  const first = await createUser();
  const second = await createUser();
  await createEntry(first.id);
  await createEntry(second.id);
  const abandoned = await createPendingMatch(first, second);
  await database.db
    .update(matches)
    .set({
      status: "running",
      leaseExpiresAt: new Date(Date.now() - 60_000),
      executionId: "00000000-0000-4000-8000-000000000002",
    })
    .where(eq(matches.id, abandoned.id));

  const swept = await failExpiredLeases(database.db);
  expect(swept).toBeGreaterThanOrEqual(1);
  const row = await matchRow(abandoned.id);
  expect(row.status).toBe("failed");
  expect(row.failureReason).toBe("WORKER_LOST");

  // Unknown frozen releases are never claimed by this worker; with no other
  // claimable pending match the probe returns null.
  await createPendingMatch(first, second, { release: "paper@9.9.9" });
  expect(await claimNextMatch(database.db, claimableReleases())).toBeNull();

  // Concurrent claims pick distinct rows via SKIP LOCKED; each fresh initiator
  // owns exactly one unfinished match.
  const third = await createUser();
  const fourth = await createUser();
  await createEntry(third.id);
  await createEntry(fourth.id);
  const one = await createPendingMatch(third, first);
  const two = await createPendingMatch(fourth, second);

  // Concurrent claims pick distinct rows via SKIP LOCKED.
  const claims = await Promise.all([
    claimNextMatch(database.db, claimableReleases()),
    claimNextMatch(database.db, claimableReleases()),
  ]);
  const ids = new Set(claims.map((claimed) => claimed?.id));
  expect(ids.has(one.id)).toBe(true);
  expect(ids.has(two.id)).toBe(true);
  expect(ids.size).toBe(2);
});
