import { expect, test } from "vitest";
import { sha256Hex } from "../src/sha256";

async function subtleHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("the plain-HTTP fallback digest matches WebCrypto across padding boundaries", async () => {
  // 0、54、55、56、57、64、65 字节恰好跨越 SHA-256 填充的分块边界，另含多字节 UTF-8。
  const samples = [
    "",
    "a",
    "x".repeat(54),
    "y".repeat(55),
    "z".repeat(56),
    "w".repeat(57),
    "v".repeat(64),
    "u".repeat(65),
    "终点🏁",
  ];
  for (const text of samples) {
    const bytes = new TextEncoder().encode(text);
    expect(sha256Hex(bytes), text).toBe(await subtleHex(bytes));
  }
  const long = new TextEncoder().encode("0123456789abcdef".repeat(8192));
  expect(sha256Hex(long)).toBe(await subtleHex(long));
  // 已知向量兜底：即使 WebCrypto 本身异常，实现仍有独立基准。
  expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(sha256Hex(new Uint8Array(0))).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});
