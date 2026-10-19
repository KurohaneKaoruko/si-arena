import { defineConfig } from "tsdown";

// Resolve paths from the calling workspace, preserving its public dist layout.
export default defineConfig({
  cwd: process.cwd(),
  entry: ["src/**/*.ts"],
  root: "src",
  outDir: "dist",
  format: "esm",
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  target: "es2023",
  unbundle: true,
  clean: true,
  sourcemap: true,
  dts: { sourcemap: true },
  define: {
    BUILD_DEFAULT_SERVER_URL: JSON.stringify(
      process.env.SI_ARENA_SERVER_URL ?? "http://127.0.0.1:3000",
    ),
  },
});
