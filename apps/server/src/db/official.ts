import { readFile } from "node:fs/promises";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { RESERVED_USERNAME_OFFICIAL } from "@si-arena/protocol";
import type { RegisteredGame } from "../games";
import { gameEntries, users } from "@si-arena/db";

/**
 * Idempotent deployment initialization: upsert the official account and install each
 * game's official bot source. Rating and match statistics are never touched here.
 */
export async function ensureOfficialAccounts(
  db: NodePgDatabase,
  games: readonly RegisteredGame[],
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
