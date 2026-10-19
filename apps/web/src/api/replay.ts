import { checkedResponse } from "./client";

/** Bound the download before constructing a Blob, including chunked responses. */
export async function downloadReplay(path: string, signal: AbortSignal): Promise<Blob> {
  const response = await checkedResponse(await fetch(path, { signal }));
  const max = 32 * 1024 * 1024;
  if (Number(response.headers.get("Content-Length")) > max) {
    await response.body?.cancel();
    throw new Error("回放压缩文件不能超过 32 MiB");
  }
  if (!response.body) throw new Error("回放文件为空");
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > max) throw new Error("回放压缩文件不能超过 32 MiB");
      chunks.push(new Uint8Array(chunk.value).buffer);
    }
    return new Blob(chunks, { type: "application/gzip" });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
