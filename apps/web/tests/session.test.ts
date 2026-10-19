import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  authorizedRequest,
  changePassword,
  clearSession,
  restoreSession,
  safeNextPath,
  session,
  SESSION_KEY,
  signIn,
  signOut,
} from "../src/auth/session";
import { noContent } from "../src/api/client";

const user = { id: "first", username: "first", official: false };
const token = "a".repeat(43);
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  localStorage.clear();
  clearSession();
});
afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

test("restores the saved bearer token and removes an expired session", async () => {
  localStorage.setItem(SESSION_KEY, token);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ user }))
    .mockResolvedValueOnce(json({ code: "UNAUTHORIZED", message: "请登录" }, 401));
  vi.stubGlobal("fetch", fetch);
  await restoreSession();
  expect(session.user).toEqual(user);
  expect(session.ready).toBe(true);
  expect(fetch.mock.calls[0]?.[1].headers.Authorization).toBe(`Bearer ${token}`);
  await expect(authorizedRequest("/private", noContent)).rejects.toMatchObject({ status: 401 });
  expect(session.user).toBeNull();
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
});

test("a failed restore retains the saved token for an explicit retry", async () => {
  localStorage.setItem(SESSION_KEY, token);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(json({ user })),
  );
  await restoreSession();
  expect(session.error).toContain("网络");
  expect(session.ready).toBe(true);
  expect(localStorage.getItem(SESSION_KEY)).toBe(token);
  await restoreSession();
  expect(session.user).toEqual(user);
  expect(session.error).toBe("");
});

test("wrong current password keeps the session; successful change revokes it locally", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ user, token }))
    .mockResolvedValueOnce(json({ code: "INVALID_CREDENTIALS", message: "当前密码错误" }, 401))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "first", "secret");
  await expect(changePassword("wrong", "new-secret")).rejects.toMatchObject({
    code: "INVALID_CREDENTIALS",
  });
  expect(session.user).toEqual(user);
  await changePassword("secret", "new-secret");
  expect(session.user).toBeNull();
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
});

test("an old request cannot erase a newer login or revive a cleared session", async () => {
  let resolveOld!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ user, token }))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce(json({ user: { ...user, id: "second" }, token: "b".repeat(43) }));
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "first", "secret");
  const oldRequest = authorizedRequest("/private", noContent).catch((error) => error);
  await signIn("login", "second", "secret");
  resolveOld(json({ code: "UNAUTHORIZED", message: "过期" }, 401));
  await oldRequest;
  expect(session.user?.id).toBe("second");
  let resolveRestore!: (response: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveRestore = resolve;
      }),
  );
  const restore = restoreSession();
  clearSession();
  resolveRestore(json({ user }));
  await restore;
  expect(session.user).toBeNull();
});

test("logout waits for server revocation and retains credentials on network failure", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ user, token }))
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await signIn("login", "first", "secret");
  await expect(signOut()).rejects.toThrow();
  expect(session.user).toEqual(user);
  await signOut();
  expect(session.user).toBeNull();
});

test("login redirects stay within the site and cannot loop through authentication pages", () => {
  for (const path of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/\n/evil.test",
    "/login?next=/",
    "/register",
    undefined,
  ])
    expect(safeNextPath(path)).toBe("/");
  expect(safeNextPath("/games/paper?page=2#participate")).toBe("/games/paper?page=2#participate");
});
