import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import { FramedChannel } from "../src/framing";
import { SandboxSystemError } from "../src/types";
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

test("production isolation never silently falls back to local execution", async () => {
  await expect(
    isolateProcess({ kind: "cgroup-v2", root: "relative" }, "test", process.pid, 256 * 1024 * 1024),
  ).rejects.toBeInstanceOf(SandboxSystemError);
});
