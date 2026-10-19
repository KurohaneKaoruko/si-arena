import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { get } from "node:http";
import { serveReplay } from "../src/viewer";

test("serves only fixed local assets and the selected replay, then closes on cancellation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "si-arena-viewer-"));
  await writeFile(join(directory, "index.html"), "<h1>viewer</h1>");
  await writeFile(join(directory, "match.gz"), new Uint8Array([1, 2, 3]));
  const cancellation = new AbortController();
  let ready!: (url: string) => void;
  const address = new Promise<string>((resolve) => {
    ready = resolve;
  });
  const running = serveReplay({
    directory,
    replay: join(directory, "match.gz"),
    signal: cancellation.signal,
    write(line) {
      ready((JSON.parse(line) as { url: string }).url);
    },
  });
  try {
    const url = await address;
    expect(await (await fetch(url)).text()).toContain("viewer");
    const file = await fetch(new URL("/replay.json.gz", url));
    expect(file.headers.get("Content-Encoding")).toBeNull();
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await fetch(new URL("/package.json", url))).status).toBe(404);
    const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
      get(url, { headers: { host: "attacker.example" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    expect(foreignHost).toBe(403);
    expect((await fetch(url, { method: "POST" })).status).toBe(403);
    cancellation.abort();
    await running;
    await expect(fetch(url)).rejects.toThrow();
  } finally {
    cancellation.abort();
    await running;
    await rm(directory, { recursive: true, force: true });
  }
});
