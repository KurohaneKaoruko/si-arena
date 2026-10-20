import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";
import testConfig from "../typescript/test.json" with { type: "json" };

const testConfigUrl = new URL("../typescript/test.json", import.meta.url);

// Share source mappings with TypeScript. Production exports still point to dist.
const alias = Object.entries(testConfig.compilerOptions.paths).map(([pattern, targets]) => {
  const target = targets[0];
  if (!target) throw new Error(`Missing test source path for ${pattern}`);
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return {
    find: new RegExp(`^${escaped.replace("*", "(.+)")}$`),
    replacement: fileURLToPath(new URL(target, testConfigUrl)).replace("*", "$1"),
  };
});

export default defineProject({
  resolve: { alias },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    // 共享 CI runner 比本地慢 2-3 倍，jsdom 回放类测试常在默认 5s 边缘抖动；
    // 更长的测试仍按惯例显式标注自己的预算。
    testTimeout: 15000,
    clearMocks: true,
    restoreMocks: true,
  },
});
