import vue from "@vitejs/plugin-vue";
import { defineProject, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared";

export default mergeConfig(
  shared,
  defineProject({
    root: import.meta.dirname,
    plugins: [vue()],
    test: { name: "web", environment: "jsdom" },
  }),
);
