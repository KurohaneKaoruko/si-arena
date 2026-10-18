import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    projects: [
      "apps/*/vitest*.config.ts",
      "packages/*/vitest*.config.ts",
      "games/*/vitest*.config.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["{apps,packages,games}/*/src/**/*.{ts,vue}"],
      exclude: ["**/*.d.ts"],
    },
  },
});
