import { Duplex, PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { expect, test } from "vitest";
import { FramedChannel } from "../src/framing";
import { RunnerSystemError } from "../src/types";
import { isolateProcess } from "../src/isolation";

test("IPC accepts split headers and bodies, preserving frame order", () => {
  const stream = new PassThrough();
  const messages: unknown[] = [];
  const channel = new FramedChannel(
    stream,
    64,
    (value) => messages.push(value),
    (error) => {
      throw error;
    },
  );
  const body = Buffer.from('{"tick":0}');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  stream.write(header.subarray(0, 1));
  stream.write(header.subarray(1));
  stream.write(body.subarray(0, 3));
  expect(messages).toEqual([]);
  stream.write(body.subarray(3));
  channel.send({ tick: 1 });
  expect(messages).toEqual([{ tick: 0 }, { tick: 1 }]);
  channel.close();
});

test("oversized declared frames are rejected before buffering or parsing payload", () => {
  const stream = new PassThrough();
  let failure: Error | undefined;
  const channel = new FramedChannel(
    stream,
    16,
    () => {
      throw new Error("must not parse");
    },
    (error) => {
      failure = error;
    },
  );
  const header = Buffer.alloc(4);
  header.writeUInt32BE(0x7fffffff);
  stream.write(header);
  expect(failure).toBeInstanceOf(RangeError);
  expect(() => channel.send({})).toThrow("closed");
  channel.close();
});

test.each([1, 1024])(
  "async IPC output stays bounded with a %i-byte write threshold",
  async (writableHighWaterMark) => {
    const frames: Buffer[] = [];
    let release: (() => void) | undefined;
    const stream = new Duplex({
      writableHighWaterMark,
      read() {},
      write(chunk: Buffer, _encoding, callback) {
        frames.push(Buffer.from(chunk));
        release = callback;
      },
    });
    const channel = new FramedChannel(
      stream,
      64,
      () => {},
      () => {},
    );
    const output = (async () => {
      for (let tick = 0; tick < 8; tick++) await channel.sendAndDrain({ tick });
    })();
    try {
      for (let tick = 0; tick < 8; tick++) {
        await setImmediate();
        expect(frames).toHaveLength(tick + 1);
        expect(stream.writableLength).toBeLessThanOrEqual(68);
        expect(JSON.parse(frames[tick]!.subarray(4).toString())).toEqual({ tick });
        release!();
      }
      await output;
      expect(stream.listenerCount("drain")).toBe(0);
      expect(stream.listenerCount("close")).toBe(0);
    } finally {
      channel.close();
      await output.catch(() => {});
    }
  },
);

test("closing IPC rejects a pending backpressure wait", async () => {
  const stream = new Duplex({
    writableHighWaterMark: 1,
    read() {},
    write() {},
  });
  const channel = new FramedChannel(
    stream,
    64,
    () => {},
    () => {},
  );
  const output = expect(channel.sendAndDrain({ tick: 0 })).rejects.toThrow("IPC is closed");
  channel.close();
  await output;
  expect(stream.listenerCount("drain")).toBe(0);
  expect(stream.listenerCount("close")).toBe(0);
});

test("production isolation never silently falls back to local execution", async () => {
  await expect(
    isolateProcess({ kind: "cgroup-v2", root: "relative" }, "test", process.pid, 256 * 1024 * 1024),
  ).rejects.toBeInstanceOf(RunnerSystemError);
});
