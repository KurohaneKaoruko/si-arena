import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ReplayStore } from "../src/replay-store";

let root: string;
let store: ReplayStore;
let matchId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "arena-replay-store-"));
  store = new ReplayStore(root);
  await store.prepare();
  matchId = randomUUID();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("publishing the same immutable candidate is safe to repeat and race", async () => {
  const candidate = store.candidatePath(matchId, randomUUID());
  await writeFile(candidate, "immutable replay");
  await Promise.all([store.publish(candidate, matchId), store.publish(candidate, matchId)]);
  await store.publish(candidate, matchId);
  expect(await readFile(store.finalPath(matchId), "utf8")).toBe("immutable replay");
  expect(await readFile(candidate, "utf8")).toBe("immutable replay");
});

test("a different execution cannot replace the final even when its bytes are identical", async () => {
  const first = store.candidatePath(matchId, randomUUID());
  const other = store.candidatePath(matchId, randomUUID());
  await writeFile(first, "same bytes");
  await writeFile(other, "same bytes");
  await store.publish(first, matchId);
  await expect(store.publish(other, matchId)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(store.finalPath(matchId), "utf8")).toBe("same bytes");
  await expect(store.publish(first, matchId)).resolves.toBeUndefined();
});

test.skipIf(process.platform === "win32")(
  "a symlink is not treated as a previous publication",
  async () => {
    const candidate = store.candidatePath(matchId, randomUUID());
    await writeFile(candidate, "immutable replay");
    await symlink(candidate, store.finalPath(matchId));
    await expect(store.publish(candidate, matchId)).rejects.toMatchObject({ code: "EEXIST" });
  },
);
