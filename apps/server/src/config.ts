import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function readServerConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError("API_PORT must be an integer between 1 and 65535");
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return {
    host: env.API_HOST ?? "127.0.0.1",
    port,
    logLevel: env.LOG_LEVEL ?? "info",
    databaseUrl,
    replaysDir: resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
      env.REPLAYS_DIR ?? "data/replays",
    ),
  };
}
