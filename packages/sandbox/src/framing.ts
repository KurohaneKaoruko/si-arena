import type { Duplex } from "node:stream";

/** One bounded frame buffered at a time; reject length before JSON parsing. */
export class FramedChannel {
  private header = Buffer.alloc(4);
  private headerUsed = 0;
  private body: Buffer | undefined;
  private bodyUsed = 0;
  private closed = false;

  constructor(
    private stream: Duplex,
    private maxBytes: number,
    onMessage: (message: unknown) => void,
    onError: (error: Error) => void,
  ) {
    stream.on("data", (chunk: Buffer) => {
      if (this.closed) return;
      try {
        let offset = 0;
        while (offset < chunk.length) {
          if (!this.body) {
            const count = Math.min(4 - this.headerUsed, chunk.length - offset);
            chunk.copy(this.header, this.headerUsed, offset, offset + count);
            this.headerUsed += count;
            offset += count;
            if (this.headerUsed < 4) continue;
            const length = this.header.readUInt32BE();
            if (length === 0 || length > this.maxBytes)
              throw new RangeError("Invalid IPC frame length");
            this.body = Buffer.allocUnsafe(length);
          }
          const count = Math.min(this.body.length - this.bodyUsed, chunk.length - offset);
          chunk.copy(this.body, this.bodyUsed, offset, offset + count);
          offset += count;
          this.bodyUsed += count;
          if (this.bodyUsed === this.body.length) {
            const frame = this.body;
            this.body = undefined;
            this.bodyUsed = 0;
            this.headerUsed = 0;
            onMessage(JSON.parse(frame.toString("utf8")) as unknown);
          }
        }
      } catch (error) {
        this.closed = true;
        onError(error instanceof Error ? error : new Error("Invalid IPC"));
      }
    });
    stream.on("error", onError);
  }

  send(value: unknown): void {
    if (this.closed) throw new Error("IPC is closed");
    const body = Buffer.from(JSON.stringify(value));
    if (body.length > this.maxBytes) throw new RangeError("IPC message exceeds configured limit");
    // write() does not cap the queue. Close instead of accumulating arbitrary output.
    if (this.stream.writableLength + body.length + 4 > this.maxBytes * 2 + 8)
      throw new RangeError("IPC queue exceeds configured limit");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(body.length);
    this.stream.write(Buffer.concat([header, body]));
  }

  close(): void {
    this.closed = true;
    this.stream.destroy();
  }
}
