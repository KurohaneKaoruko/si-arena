import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join, resolve as resolvePath } from "node:path";
import { once } from "node:events";

export async function serveReplay(options: {
  directory: string;
  replay: string;
  write: (line: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  options.signal?.throwIfAborted();
  const files = new Map<string, string>();
  async function collect(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await collect(path, url);
      else if (entry.isFile()) files.set(url, path);
    }
  }
  await collect(resolvePath(options.directory), "");
  if (!files.has("/index.html")) throw new Error("Local replay viewer is missing");
  const replayInfo = await stat(options.replay);
  if (!replayInfo.isFile() || replayInfo.size > 32 * 1024 * 1024)
    throw new Error("Replay must be a regular gzip file no larger than 32 MiB");
  files.set("/replay.json.gz", options.replay);
  files.set("/", files.get("/index.html")!);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".gz": "application/gzip",
    ".svg": "image/svg+xml",
  };
  const server = createServer((request, response) => {
    const address = server.address();
    if (
      !address ||
      typeof address === "string" ||
      request.headers.host !== `127.0.0.1:${address.port}` ||
      request.method !== "GET"
    ) {
      response.writeHead(403).end();
      return;
    }
    const file = files.get(request.url ?? "");
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    const stream = createReadStream(file);
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    options.signal?.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Local viewer did not start");
    options.write(
      JSON.stringify({
        type: "viewer",
        url: `http://127.0.0.1:${address.port}/`,
        message: "Open this URL to view the replay. Ctrl+C stops the local server.",
      }),
    );
    if (options.signal)
      await new Promise<void>((resolve) => {
        if (options.signal!.aborted) resolve();
        else options.signal!.addEventListener("abort", () => resolve(), { once: true });
      });
    else await once(server, "close");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
