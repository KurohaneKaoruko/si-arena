import { expect, test } from "vitest";
import {
  RESERVED_USERNAME_OFFICIAL,
  countCodePoints,
  normalizeUsername,
  validatePassword,
  validateUsername,
} from "@si-arena/protocol";
import { parseBearerAuthorization } from "../src/auth/token";
import { windowStartFor } from "../src/auth/rate-limit";

test("username validation only enforces code-point length", () => {
  expect(validateUsername("ab")).toBeNull();
  expect(validateUsername("a")).not.toBeNull();
  expect(validateUsername("a".repeat(24))).toBeNull();
  expect(validateUsername("a".repeat(25))).not.toBeNull();
  expect(validateUsername("小明")).toBeNull();
  expect(validateUsername("🚀🚀")).toBeNull();
  expect(validateUsername("user@example")).toBeNull();
  expect(validateUsername("a\u0000b")).not.toBeNull();
});

test("usernames normalize to lowercase for identity", () => {
  expect(normalizeUsername("AdaLovelace")).toBe("adalovelace");
  expect(validateUsername("OFFICIAL")).not.toBeNull();
  expect(normalizeUsername("Official")).toBe(RESERVED_USERNAME_OFFICIAL);
});

test("password validation only enforces code-point length", () => {
  expect(validatePassword("123456")).toBeNull();
  expect(validatePassword("12345")).not.toBeNull();
  expect(validatePassword("a".repeat(24))).toBeNull();
  expect(validatePassword("a".repeat(25))).not.toBeNull();
  expect(validatePassword("密码密码密码")).toBeNull();
  expect(validatePassword("pass\u0000word")).not.toBeNull();
});

test("code-point counting handles astral characters", () => {
  expect(countCodePoints("🚀")).toBe(1);
  expect("🚀".length).toBe(2);
  expect(countCodePoints("a🚀b")).toBe(3);
});

test("bearer authorization parsing", () => {
  expect(parseBearerAuthorization(undefined)).toBeNull();
  expect(parseBearerAuthorization("Basic abc")).toBeNull();
  expect(parseBearerAuthorization("bearer abc")).toBeNull();
  expect(parseBearerAuthorization("Bearer  ")).toBeNull();
  expect(parseBearerAuthorization("Bearer abc-DEF_123")).toBe("abc-DEF_123");
});

test("rate-limit windows floor to fixed boundaries", () => {
  const windowMs = 5 * 60_000;
  const start = windowStartFor(new Date("2026-10-19T00:04:59.999Z"), windowMs);
  expect(start.toISOString()).toBe("2026-10-19T00:00:00.000Z");
  const next = windowStartFor(new Date("2026-10-19T00:05:00.000Z"), windowMs);
  expect(next.toISOString()).toBe("2026-10-19T00:05:00.000Z");
});
