import { expect, test } from "vitest";
import {
  createHashLimiter,
  dummyPasswordHash,
  hashPassword,
  parseScryptHash,
  verifyPassword,
} from "../src/auth/password";

test("hashPassword stores scrypt parameters, salt, and a 64-byte digest", async () => {
  const hash = await hashPassword("correct horse battery");
  expect(hash.startsWith("scrypt$N=131072$r=8$p=1$")).toBe(true);
  const parts = parseScryptHash(hash);
  expect(parts).not.toBeNull();
  expect(parts?.salt.length).toBe(16);
  expect(parts?.digest.length).toBe(64);
});

test("verifyPassword round-trips and rejects wrong passwords", async () => {
  const hash = await hashPassword("hunter2hunter2");
  await expect(verifyPassword("hunter2hunter2", hash)).resolves.toBe(true);
  await expect(verifyPassword("hunter2hunter3", hash)).resolves.toBe(false);
});

test("verifyPassword handles unusable stored hashes", async () => {
  await expect(verifyPassword("whatever12", null)).resolves.toBe(false);
  await expect(verifyPassword("whatever12", "not-a-hash")).resolves.toBe(false);
  await expect(verifyPassword("whatever12", "scrypt$N=131072$r=8$p=1$AAAA$AAAA")).resolves.toBe(
    false,
  );
});

test("dummyPasswordHash never verifies and always burns a full scrypt run", async () => {
  const parts = parseScryptHash(dummyPasswordHash);
  expect(parts).not.toBeNull();
  expect(parts?.N).toBe(131072);
  expect(parts?.salt.length).toBe(16);
  expect(parts?.digest.length).toBe(64);
  await expect(verifyPassword("anything12", dummyPasswordHash)).resolves.toBe(false);
});

test("each password gets an independent salt", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  expect(a).not.toBe(b);
});

test("hash limiter rejects beyond the maximum without queueing", () => {
  const limiter = createHashLimiter(2);
  expect(limiter.acquire()).toBe(true);
  expect(limiter.acquire()).toBe(true);
  expect(limiter.acquire()).toBe(false);
  limiter.release();
  expect(limiter.acquire()).toBe(true);
  expect(limiter.acquire()).toBe(false);
  limiter.release();
  limiter.release();
  limiter.release();
  expect(limiter.acquire()).toBe(true);
  expect(limiter.acquire()).toBe(true);
  expect(limiter.acquire()).toBe(false);
});
