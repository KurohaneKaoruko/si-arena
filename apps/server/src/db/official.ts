import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { RESERVED_USERNAME_BOSS, RESERVED_USERNAME_OFFICIAL } from "@si-arena/protocol";
import type { RegisteredGame } from "../games";
import { gameEntries, users } from "@si-arena/db";

/**
 * Idempotent deployment initialization: upsert the official account and install each
 * game's official bot source. Rating and match statistics are never touched here.
 */
export async function ensureOfficialAccounts(
  db: NodePgDatabase,
  games: readonly Pick<RegisteredGame, "entry" | "officialBotUrl">[],
): Promise<{ games: number }> {
  const sources = await Promise.all(
    games.map(async (game) => {
      const source = await readFile(game.officialBotUrl, "utf8");
      const sourceBytes = Buffer.byteLength(source, "utf8");
      const codeBytes = game.entry.resolvedLimits.codeBytes;
      if (sourceBytes > codeBytes) {
        throw new Error(
          `Official bot for ${game.entry.id} is ${sourceBytes} bytes, exceeding the release limit of ${codeBytes} bytes`,
        );
      }
      return { game, source, sourceBytes };
    }),
  );
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        normalizedUsername: RESERVED_USERNAME_OFFICIAL,
        passwordHash: null,
        official: true,
      })
      .onConflictDoUpdate({ target: users.normalizedUsername, set: { official: true } })
      .returning({ id: users.id });
    const officialUser = inserted[0];
    if (officialUser === undefined) throw new Error("official account upsert returned no row");
    for (const { game, source, sourceBytes } of sources) {
      await tx
        .insert(gameEntries)
        .values({
          gameId: game.entry.id,
          userId: officialUser.id,
          sourceCode: source,
          sourceBytes,
          botProtocolVersion: game.entry.botProtocolVersion,
        })
        .onConflictDoUpdate({
          target: [gameEntries.gameId, gameEntries.userId],
          set: {
            sourceCode: source,
            sourceBytes,
            botProtocolVersion: game.entry.botProtocolVersion,
            updatedAt: new Date(),
          },
        });
    }
  });
  return { games: sources.length };
}

/**
 * Idempotent: installs `<bossesDir>/<gameId>.js` as the platform boss's code for
 * each game that has one and removes the boss from games that no longer do.
 * The boss source is private: it is never exposed by any route or package.
 */
export async function ensureBossAccount(
  db: NodePgDatabase,
  games: readonly Pick<RegisteredGame, "entry">[],
  bossesDir: string,
): Promise<{ games: string[] }> {
  const sources = await Promise.all(
    games.map(async (game) => {
      const path = join(bossesDir, `${game.entry.id}.js`);
      const source = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (source === null) return { game, source, sourceBytes: 0 };
      const sourceBytes = Buffer.byteLength(source, "utf8");
      if (sourceBytes > game.entry.resolvedLimits.codeBytes)
        throw new Error(`Boss bot for ${game.entry.id} exceeds the release code limit`);
      return { game, source, sourceBytes };
    }),
  );
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({ normalizedUsername: RESERVED_USERNAME_BOSS, passwordHash: null, boss: true })
      .onConflictDoUpdate({ target: users.normalizedUsername, set: { boss: true } })
      .returning({ id: users.id });
    const boss = inserted[0];
    if (boss === undefined) throw new Error("boss account upsert returned no row");
    for (const { game, source, sourceBytes } of sources) {
      if (source === null) {
        await tx
          .delete(gameEntries)
          .where(and(eq(gameEntries.gameId, game.entry.id), eq(gameEntries.userId, boss.id)));
        continue;
      }
      await tx
        .insert(gameEntries)
        .values({
          gameId: game.entry.id,
          userId: boss.id,
          sourceCode: source,
          sourceBytes,
          botProtocolVersion: game.entry.botProtocolVersion,
        })
        .onConflictDoUpdate({
          target: [gameEntries.gameId, gameEntries.userId],
          set: {
            sourceCode: source,
            sourceBytes,
            botProtocolVersion: game.entry.botProtocolVersion,
            updatedAt: new Date(),
          },
        });
    }
  });
  return {
    games: sources.filter((item) => item.source !== null).map((item) => item.game.entry.id),
  };
}
