import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { once } from "node:events";
import { utf8Bytes, type GameResult, type JsonObject, type Replay } from "@si-arena/protocol";
import type { LocalGameRegistration } from "./local-game";
import {
  collectStaticFiles,
  isLoopbackRequest,
  jsonHeaders,
  loopbackOrigin,
  staticHeaders,
} from "./static-server";

const MAX_TRACE_BYTES = 32 * 1024 * 1024;

interface DevPlayer {
  id: string;
  name: string;
  official: boolean;
}

export interface DevStatus {
  game: { id: string; name: string; release: string; botProtocolVersion: number };
  current: {
    phase: "running" | "completed" | "error";
    run: number;
    seed: number;
    completedTicks: number;
    maxTicks: number;
    players: DevPlayer[];
    result?: GameResult;
    message?: string;
  };
  lastCompleted: {
    run: number;
    matchId: string;
    seed: number;
    result: GameResult;
    finalStateHash: string;
  } | null;
  memoryTruncated: boolean;
}

export interface DevMemorySnapshot {
  tick: number;
  players: Record<string, { before: JsonObject; after: JsonObject }>;
  truncated?: true;
}

/** Per-player committed-Memory change points, kept out of replays by design. */
class MemoryTrace {
  private players = new Map<string, Array<{ tick: number; text: string }>>();
  private bytes = 0;
  private truncated = false;

  get isTruncated(): boolean {
    return this.truncated;
  }

  commit(playerId: string, tick: number, memory: JsonObject): void {
    if (this.truncated) return;
    const text = JSON.stringify(memory);
    const list = this.players.get(playerId) ?? [];
    const last = list.at(-1);
    if (last && (last.tick === tick || last.text === text)) return;
    const bytes = utf8Bytes(text);
    if (this.bytes + bytes > MAX_TRACE_BYTES) {
      this.truncated = true;
      return;
    }
    this.bytes += bytes;
    list.push({ tick, text });
    this.players.set(playerId, list);
  }

  snapshot(tick: number, playerIds: readonly string[]): DevMemorySnapshot {
    const players: DevMemorySnapshot["players"] = {};
    for (const playerId of playerIds)
      players[playerId] = {
        before: valueAtMost(this.players.get(playerId), tick - 1),
        after: valueAtMost(this.players.get(playerId), tick),
      };
    const snapshot: DevMemorySnapshot = { tick, players };
    if (this.truncated) snapshot.truncated = true;
    return snapshot;
  }
}

function valueAtMost(
  entries: ReadonlyArray<{ tick: number; text: string }> | undefined,
  tick: number,
): JsonObject {
  let found: string | undefined;
  if (entries)
    for (const entry of entries) {
      if (entry.tick > tick) break;
      found = entry.text;
    }
  return found ? (JSON.parse(found) as JsonObject) : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Local match failed";
}

/** Single-player live debug session: auto-starts one match and restarts on demand. */
export class DevSession {
  private readonly registration: LocalGameRegistration;
  private readonly botPaths: readonly string[];
  private readonly write: (line: string) => void;
  private readonly maxTicks: number;
  private readonly knownPlayers: DevPlayer[] = [];
  private runCount = 0;
  private current!: DevStatus["current"];
  private lastCompleted: DevStatus["lastCompleted"] = null;
  private replayData: Readonly<Replay<unknown, unknown>> | undefined;
  private completedTrace: MemoryTrace | undefined;
  private controller: AbortController | undefined;
  private settling: Promise<void> = Promise.resolve();
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: {
    registration: LocalGameRegistration;
    botPaths: readonly string[];
    seed: number;
    write: (line: string) => void;
  }) {
    this.registration = options.registration;
    this.botPaths = options.botPaths;
    this.write = options.write;
    this.maxTicks = options.registration.manifest.maxTicks;
    this.begin(options.seed);
  }

  get run(): number {
    return this.runCount;
  }

  get seed(): number {
    return this.current.seed;
  }

  get replay(): Readonly<Replay<unknown, unknown>> | undefined {
    return this.replayData;
  }

  /** Restarts with the given seed (or the current one); aborts a running match first. */
  restart(seed?: number): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed) return;
      if (this.controller) {
        this.controller.abort();
        await this.settling;
        // dispose() may have run while the aborted match was unwinding.
        if (this.disposed) return;
      }
      this.begin(seed ?? this.current.seed);
    });
  }

  status(): DevStatus {
    const manifest = this.registration.manifest;
    return {
      game: {
        id: manifest.id,
        name: manifest.name,
        release: manifest.release,
        botProtocolVersion: manifest.botProtocolVersion,
      },
      current: this.current,
      lastCompleted: this.lastCompleted,
      memoryTruncated: this.completedTrace?.isTruncated ?? false,
    };
  }

  /** Resolves once the active match and any queued restart have settled. */
  idle(): Promise<void> {
    return (async () => {
      await this.queue;
      await this.settling;
    })();
  }

  memorySnapshot(tick: number): DevMemorySnapshot {
    // Always serve the trace belonging to the replay being served, so a
    // restarted or failed run never rewrites Memory under the old viewer.
    if (!this.completedTrace) return { tick, players: {} };
    return this.completedTrace.snapshot(
      tick,
      this.current.players.map((player) => player.id),
    );
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  private begin(seed: number): void {
    const run = ++this.runCount;
    const controller = new AbortController();
    const trace = new MemoryTrace();
    this.controller = controller;
    this.current = {
      phase: "running",
      run,
      seed,
      completedTicks: 0,
      maxTicks: this.maxTicks,
      players: [...this.knownPlayers],
    };
    // Output failures (e.g. an EPIPE on stdout) must never wedge the session.
    this.settling = this.execute(run, seed, controller, trace).catch(() => {});
  }

  private async execute(
    run: number,
    seed: number,
    controller: AbortController,
    trace: MemoryTrace,
  ): Promise<void> {
    try {
      const prepared = await this.registration.prepare(this.botPaths, controller.signal);
      this.knownPlayers.length = 0;
      this.knownPlayers.push(
        ...prepared.players.map((player) => ({
          id: player.id,
          name: player.name,
          official: player.official,
        })),
      );
      if (this.current.run === run) this.current.players = [...this.knownPlayers];
      const summary = await prepared.run({
        seed,
        signal: controller.signal,
        onMemory: (playerId, tick, memory) => trace.commit(playerId, tick, memory),
        onTick: (completedTicks) => {
          if (this.current.run === run) this.current.completedTicks = completedTicks;
        },
      });
      if (controller.signal.aborted) return;
      const { replayData, ...match } = summary;
      this.current = {
        phase: "completed",
        run,
        seed,
        completedTicks: summary.result.completedTicks,
        maxTicks: this.maxTicks,
        players: [...this.knownPlayers],
        result: summary.result,
      };
      this.lastCompleted = {
        run,
        matchId: summary.matchId,
        seed,
        result: summary.result,
        finalStateHash: summary.finalStateHash,
      };
      if (replayData) this.replayData = replayData;
      this.completedTrace = trace;
      this.write(JSON.stringify({ type: "match", run, seed, ...match }));
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = errorMessage(error);
      this.current = {
        phase: "error",
        run,
        seed,
        completedTicks: this.current.run === run ? this.current.completedTicks : 0,
        maxTicks: this.maxTicks,
        players: [...this.knownPlayers],
        message,
      };
      this.write(JSON.stringify({ type: "error", run, seed, message }));
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.controller?.abort();
    await this.idle();
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, jsonHeaders());
  response.end(JSON.stringify(value));
}

function streamFile(response: ServerResponse, path: string): void {
  response.writeHead(200, staticHeaders(path));
  const stream = createReadStream(path);
  stream.on("error", () => response.destroy());
  response.on("close", () => stream.destroy());
  stream.pipe(response);
}

async function readRestartBody(request: IncomingMessage): Promise<{ seed?: number } | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 1024) return undefined;
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { seed } = value as { seed?: unknown };
  if (seed === undefined) return {};
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    return undefined;
  return { seed };
}

export async function serveDev(options: {
  directory: string;
  registration: LocalGameRegistration;
  botPaths: readonly string[];
  seed: number;
  write: (line: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  options.signal?.throwIfAborted();
  const files = await collectStaticFiles(options.directory);
  const page = files.get("/dev.html");
  if (!page) throw new Error("Dev page assets are missing; fetch the current development package");
  files.set("/", page);
  const session = new DevSession({
    registration: options.registration,
    botPaths: options.botPaths,
    seed: options.seed,
    write: options.write,
  });
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => response.destroy());
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isLoopbackRequest(server.address(), request.headers.host)) {
      response.writeHead(403).end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/session" && request.method === "GET") {
      sendJson(response, 200, session.status());
      return;
    }
    if (url.pathname === "/api/session/replay" && request.method === "GET") {
      const replay = session.replay;
      if (!replay) {
        sendJson(response, 409, { error: "REPLAY_NOT_READY" });
        return;
      }
      sendJson(response, 200, replay);
      return;
    }
    if (url.pathname === "/api/session/memory" && request.method === "GET") {
      const raw = url.searchParams.get("tick");
      const tick = /^[0-9]{1,8}$/.test(raw ?? "") ? Number(raw) : Number.NaN;
      if (!Number.isInteger(tick) || tick > session.status().current.maxTicks) {
        sendJson(response, 400, { error: "VALIDATION_ERROR" });
        return;
      }
      sendJson(response, 200, session.memorySnapshot(tick));
      return;
    }
    if (url.pathname === "/api/session/restart" && request.method === "POST") {
      // Browsers attach Origin to every POST, including same-origin ones; a
      // foreign origin means a cross-site page is probing the loopback service.
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== loopbackOrigin(server.address())) {
        sendJson(response, 403, { error: "FORBIDDEN_ORIGIN" });
        return;
      }
      const body = await readRestartBody(request);
      if (!body) {
        sendJson(response, 400, { error: "VALIDATION_ERROR" });
        return;
      }
      await session.restart(body.seed);
      sendJson(response, 200, { ok: true, run: session.run, seed: session.seed });
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(403).end();
      return;
    }
    const file = files.get(url.pathname);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    streamFile(response, file);
  }

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    options.signal?.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Local dev server did not start");
    options.write(
      JSON.stringify({
        type: "dev",
        url: `http://127.0.0.1:${address.port}/`,
        message: "Open this URL to debug. Ctrl+C stops the local server.",
        game: {
          id: options.registration.manifest.id,
          release: options.registration.manifest.release,
        },
        seed: session.seed,
      }),
    );
    if (options.signal)
      await new Promise<void>((resolve) => {
        if (options.signal!.aborted) resolve();
        else options.signal!.addEventListener("abort", () => resolve(), { once: true });
      });
    else await once(server, "close");
  } finally {
    await session.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
