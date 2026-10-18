import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";
import testConfig from "./tsconfig.test.json" with { type: "json" };

// Share source mappings with TypeScript. Production exports still point to dist.
const alias = Object.entries(testConfig.compilerOptions.paths).map(([pattern, targets]) => {
  const target = targets[0];
  if (!target) throw new Error(`Missing test source path for ${pattern}`);
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return {
    find: new RegExp(`^${escaped.replace("*", "(.+)")}$`),
    replacement: fileURLToPath(new URL(target, import.meta.url)).replace("*", "$1"),
  };
});

export default defineProject({
  resolve: { alias },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
