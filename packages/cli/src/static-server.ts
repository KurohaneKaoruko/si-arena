import { readdir } from "node:fs/promises";
import { extname, join, resolve as resolvePath } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".gz": "application/gzip",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

/** Loopback servers must reject foreign Host headers to prevent DNS rebinding. */
export function isLoopbackRequest(
  address: { port: number } | string | null,
  host: string | undefined,
): boolean {
  return !!address && typeof address !== "string" && host === `127.0.0.1:${address.port}`;
}

/** The exact origin browsers attach to same-origin requests against this server. */
export function loopbackOrigin(address: { port: number } | string | null): string | undefined {
  return address && typeof address !== "string" ? `http://127.0.0.1:${address.port}` : undefined;
}

export function staticHeaders(path: string): Record<string, string> {
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  return {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  };
}

export function jsonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  };
}

export async function collectStaticFiles(directory: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function collect(root: string, prefix: string) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      const url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await collect(path, url);
      else if (entry.isFile()) files.set(url, path);
    }
  }
  await collect(resolvePath(directory), "");
  return files;
}
