import { defineProject, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared";

export default mergeConfig(
  shared,
  defineProject({
    root: import.meta.dirname,
    test: { name: "server" },
  }),
);
