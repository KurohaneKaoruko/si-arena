import vue from "@vitejs/plugin-vue";
import { defineProject, mergeConfig } from "vitest/config";
import shared from "../../configs/vitest/shared";

const project = mergeConfig(
  shared,
  defineProject({
    root: import.meta.dirname,
    plugins: [vue()],
    test: { name: "player", environment: "node" },
  }),
);

// Vite concatenates arrays, so replace the shared include after merging.
project.test = { ...project.test, include: ["tests/core/**/*.test.ts"] };
export default project;
