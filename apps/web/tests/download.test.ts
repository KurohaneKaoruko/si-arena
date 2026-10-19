import { afterEach, expect, test, vi } from "vitest";
import { downloadReplay } from "../src/api/replay";
afterEach(() => vi.unstubAllGlobals());
test("rejects oversized chunked or declared replay downloads before retaining an oversized Blob", async () => {
  const cancel = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }), {
        headers: { "Content-Length": String(33 * 1024 * 1024) },
      }),
    ),
  );
  await expect(downloadReplay("/replay", new AbortController().signal)).rejects.toThrow("32 MiB");
  expect(cancel).toHaveBeenCalled();
  const chunks = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(33 * 1024 * 1024));
    },
    cancel,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(chunks)));
  await expect(downloadReplay("/replay", new AbortController().signal)).rejects.toThrow("32 MiB");
  expect(cancel).toHaveBeenCalledTimes(2);
});
test("download errors preserve the API error and a successful response preserves exact bytes", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "REPLAY_NOT_READY", message: "比赛尚未完成" }), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]))),
  );
  await expect(downloadReplay("/replay", new AbortController().signal)).rejects.toMatchObject({
    code: "REPLAY_NOT_READY",
  });
  const file = await downloadReplay("/replay", new AbortController().signal);
  expect(file.size).toBe(3);
});
