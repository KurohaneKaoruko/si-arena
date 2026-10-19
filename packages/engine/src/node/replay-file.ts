import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip, type Gzip } from "node:zlib";
import { stringifyJson, utf8Bytes } from "@si-arena/protocol";
import {
  EngineError,
  type ReplayFooter,
  type ReplayHeader,
  type ReplaySink,
  type ReplayTick,
} from "../types";

/** Single-use, bounded streaming JSON/gzip candidate; destination creation never overwrites. */
export class ReplayFileSink<State, Action> implements ReplaySink<State, Action> {
  private readonly temporary: string;
  private gzip: Gzip | undefined;
  private completion: Promise<void> | undefined;
  private failure: unknown;
  private started = false;
  private count = 0;
  private bytes = 0;
  private finished = false;
  private ownsTemporary = false;
  private linked = false;
  constructor(
    readonly path: string,
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
      throw new RangeError("Invalid replay file budget");
    this.temporary = `${path}.${randomUUID()}.partial`;
  }
  async start(header: ReplayHeader<State>): Promise<void> {
    if (this.started) throw new EngineError("Replay sinks can only be used once");
    this.started = true;
    await mkdir(dirname(this.path), { recursive: true });
    this.gzip = createGzip();
    const output = createWriteStream(this.temporary, { flags: "wx", mode: 0o600 });
    output.once("open", () => {
      this.ownsTemporary = true;
    });
    this.completion = pipeline(this.gzip, output).catch((error) => {
      this.failure = error;
    });
    const prefix = stringifyJson(header, { maxBytes: this.maxBytes });
    await this.write(`${prefix.slice(0, -1)},"ticks":[`);
  }
  async append(tick: ReplayTick<Action>): Promise<void> {
    if (!this.gzip || this.finished || tick.tick !== this.count)
      throw new EngineError("Invalid replay write order");
    await this.write(`${this.count ? "," : ""}${stringifyJson(tick, { maxBytes: this.maxBytes })}`);
    this.count++;
  }
  async finish(footer: ReplayFooter): Promise<void> {
    if (!this.gzip || this.finished || footer.result.completedTicks !== this.count)
      throw new EngineError("Invalid replay completion");
    await this.write(`],${stringifyJson(footer, { maxBytes: this.maxBytes }).slice(1)}`);
    this.gzip.end();
    await this.completion;
    if (this.failure) throw this.failure;
    const file = await open(this.temporary, "r+");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    // link() atomically creates the destination or fails with EEXIST.
    await link(this.temporary, this.path);
    this.linked = true;
    if (process.platform !== "win32") {
      const directory = await open(dirname(this.path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    await unlink(this.temporary);
    this.finished = true;
  }
  private async write(text: string): Promise<void> {
    if (!this.gzip || this.failure)
      throw this.failure ?? new EngineError("Replay stream not ready");
    this.bytes += utf8Bytes(text);
    if (this.bytes > this.maxBytes)
      throw new RangeError("Replay file exceeds uncompressed byte budget");
    await new Promise<void>((resolve, reject) => {
      this.gzip!.write(text, (error) => (error ? reject(error) : resolve()));
    });
    if (this.failure) throw this.failure;
  }
  async abort(): Promise<void> {
    this.gzip?.destroy();
    await this.completion;
    if (this.linked && !this.finished) await unlink(this.path).catch(() => {});
    if (this.ownsTemporary)
      await unlink(this.temporary).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
  }
}

/** Bound both compressed input and expanded output before parsing untrusted JSON. */
export async function readReplayFile(
  path: string,
  options: { maxCompressedBytes?: number; maxBytes?: number } = {},
): Promise<unknown> {
  const maxCompressed = options.maxCompressedBytes ?? 32 * 1024 * 1024;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (
    !Number.isSafeInteger(maxCompressed) ||
    maxCompressed <= 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0
  )
    throw new RangeError("Invalid replay read limits");
  let compressed = 0,
    expanded = 0;
  const chunks: Buffer[] = [];
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      compressed += chunk.byteLength;
      callback(
        compressed > maxCompressed ? new RangeError("Compressed replay exceeds byte budget") : null,
        chunk,
      );
    },
  });
  const collector = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      expanded += chunk.byteLength;
      if (expanded > maxBytes) {
        callback(new RangeError("Expanded replay exceeds byte budget"));
        return;
      }
      chunks.push(chunk);
      callback();
    },
  });
  await pipeline(createReadStream(path), meter, createGunzip(), collector);
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, expanded)),
  ) as unknown;
}
