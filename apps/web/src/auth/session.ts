import type { AuthUser } from "@si-arena/protocol";
import { reactive } from "vue";
import { ApiError, apiRequest, errorMessage, jsonBody, noContent } from "../api/client";
import { parseAuthToken, parseAuthUser } from "../api/contracts";

export const SESSION_KEY = "si-arena.session";
export const session = reactive({ user: null as AuthUser | null, ready: false, error: "" });
let token: string | null = null;
let revision = 0;
function setToken(value: string | null) {
  token = value;
  try {
    if (value) localStorage.setItem(SESSION_KEY, value);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* Continue with an in-memory session when storage is disabled. */
  }
}
export function clearSession() {
  revision++;
  setToken(null);
  session.user = null;
  session.ready = true;
  session.error = "";
}
export async function restoreSession() {
  const version = ++revision;
  try {
    token = localStorage.getItem(SESSION_KEY);
  } catch {
    /* Keep the current in-memory token. */
  }
  const saved = token;
  session.user = null;
  session.ready = false;
  session.error = "";
  if (!saved) {
    session.ready = true;
    return;
  }
  try {
    const result = await apiRequest("/api/auth/me", parseAuthUser, {
      headers: { Authorization: `Bearer ${saved}` },
    });
    if (version === revision) session.user = result.user;
  } catch (error) {
    if (version !== revision) return;
    if (error instanceof ApiError && error.status === 401) clearSession();
    else session.error = errorMessage(error);
  } finally {
    if (version === revision) session.ready = true;
  }
}
export function syncSession(event: StorageEvent) {
  if (event.key === SESSION_KEY || event.key === null) void restoreSession();
}
export async function signIn(
  mode: "login" | "register",
  username: string,
  password: string,
  signal?: AbortSignal,
) {
  const version = ++revision;
  try {
    const result = await apiRequest(`/api/auth/${mode}`, parseAuthToken, {
      method: "POST",
      ...jsonBody({ username, password }),
      signal: signal ?? null,
    });
    if (version !== revision || signal?.aborted) return false;
    setToken(result.token);
    session.user = result.user;
    session.ready = true;
    session.error = "";
    return true;
  } finally {
    if (version === revision) session.ready = true;
  }
}
export async function authorizedRequest<T>(
  path: string,
  parse: (raw: unknown) => T,
  options: RequestInit = {},
): Promise<T> {
  const saved = token;
  if (!saved) throw new ApiError(401, "UNAUTHORIZED", "请先登录。");
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${saved}`);
  try {
    return await apiRequest(path, parse, { ...options, headers });
  } catch (error) {
    if (error instanceof ApiError && error.code === "UNAUTHORIZED" && token === saved)
      clearSession();
    throw error;
  }
}
export async function signOut() {
  const saved = token;
  await authorizedRequest("/api/auth/logout", noContent, { method: "POST" });
  if (token === saved) clearSession();
}
export async function changePassword(
  oldPassword: string,
  newPassword: string,
  signal?: AbortSignal,
) {
  const saved = token;
  await authorizedRequest("/api/auth/password", noContent, {
    method: "PUT",
    ...jsonBody({ oldPassword, newPassword }),
    signal: signal ?? null,
  });
  if (token !== saved) return false;
  clearSession();
  return true;
}
export function safeNextPath(value: unknown): string {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    ![...value].some((character) => character <= " " || character === "\\") &&
    !/^\/(login|register)([/?#]|$)/.test(value)
    ? value
    : "/";
}
