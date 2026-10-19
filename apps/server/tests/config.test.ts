import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { readServerConfig } from "../src/config";
import { resolve } from "node:path";

test("replay directory is relative to the repository root and preserves absolute paths", () => {
  for (const dir of [undefined, "data/custom-replays", "/tmp/si-arena-replays"]) {
    const env = {
      DATABASE_URL: "postgresql://localhost/si_arena",
      ...(dir ? { REPLAYS_DIR: dir } : {}),
    };
    expect(readServerConfig(env).replaysDir).toBe(
      resolve(fileURLToPath(new URL("../../../", import.meta.url)), dir ?? "data/replays"),
    );
  }
  expect(readServerConfig({ DATABASE_URL: "postgresql://localhost/si_arena" }).replaysDir).toBe(
    fileURLToPath(new URL("../../../data/replays", import.meta.url)),
  );
});
