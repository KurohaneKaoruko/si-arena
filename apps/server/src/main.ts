import { buildApp } from "./app";
import { readServerConfig } from "./config";
import { sweepExpiredAuthData } from "./db/cleanup";
import { createDatabase } from "@si-arena/db";
import { ensureOfficialAccounts } from "./db/official";
import { registeredGames } from "./games";

const config = readServerConfig();
const { db, close } = createDatabase(config.databaseUrl);
const app = buildApp({ logger: { level: config.logLevel }, db, replaysDir: config.replaysDir });

let stopped = false;
async function shutdown(): Promise<void> {
  if (stopped) return;
  stopped = true;
  await app.close();
  await close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().catch((error) => app.log.error(error));
  });
}
try {
  const result = await ensureOfficialAccounts(db, registeredGames);
  app.log.info(`Official accounts initialized for ${result.games} game(s)`);
  const sweep = setInterval(() => {
    void sweepExpiredAuthData(db).catch((error) => app.log.warn(error, "auth data sweep failed"));
  }, 10 * 60_000);
  sweep.unref();
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await shutdown();
}
