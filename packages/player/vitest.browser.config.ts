import { defineProject, mergeConfig } from "vitest/config";
import shared from "../../configs/vitest/shared";
const project = mergeConfig(
  shared,
  defineProject({
    root: import.meta.dirname,
    test: { name: "player-browser", environment: "node" },
  }),
);

project.test = { ...project.test, include: ["tests/browser/**/*.test.ts"] };
export default project;
