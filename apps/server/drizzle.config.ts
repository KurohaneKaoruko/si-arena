import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "drizzle-kit";

if (existsSync("../../.env")) loadEnvFile("../../.env");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL before running database commands.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/**/*.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
