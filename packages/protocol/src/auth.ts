export const USERNAME_MIN_CODE_POINTS = 2;
export const USERNAME_MAX_CODE_POINTS = 24;
export const PASSWORD_MIN_CODE_POINTS = 6;
export const PASSWORD_MAX_CODE_POINTS = 24;

/** Reserved for the deployment-initialized official account; regular users cannot register it. */
export const RESERVED_USERNAME_OFFICIAL = "official";
export const RESERVED_USERNAME_BOSS = "boss";

export interface AuthUser {
  id: string;
  username: string;
  official: boolean;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface PasswordChangeRequest {
  oldPassword: string;
  newPassword: string;
}

export interface AuthTokenBody {
  user: AuthUser;
  token: string;
}

export interface AuthUserBody {
  user: AuthUser;
}

export function countCodePoints(value: string): number {
  return [...value].length;
}

/** Lowercase form is the canonical identity: uniqueness and login lookups both use it. */
export function normalizeUsername(username: string): string {
  return username.toLowerCase();
}

/** Returns a human-readable reason when the username cannot be registered, otherwise null. */
export function validateUsername(username: string): string | null {
  if (username.includes("\u0000")) return "用户名不能包含空字节（NUL）字符";
  const normalized = normalizeUsername(username);
  const length = countCodePoints(normalized);
  if (length < USERNAME_MIN_CODE_POINTS || length > USERNAME_MAX_CODE_POINTS) {
    return `用户名长度需在 ${USERNAME_MIN_CODE_POINTS}-${USERNAME_MAX_CODE_POINTS} 个字符之间`;
  }
  if (normalized === RESERVED_USERNAME_OFFICIAL || normalized === RESERVED_USERNAME_BOSS)
    return "该用户名为官方保留名";
  return null;
}

/** Returns a human-readable reason when the password is unacceptable, otherwise null. */
export function validatePassword(password: string): string | null {
  if (password.includes("\u0000")) return "密码不能包含空字节（NUL）字符";
  const length = countCodePoints(password);
  if (length < PASSWORD_MIN_CODE_POINTS || length > PASSWORD_MAX_CODE_POINTS) {
    return `密码长度需在 ${PASSWORD_MIN_CODE_POINTS}-${PASSWORD_MAX_CODE_POINTS} 个字符之间`;
  }
  return null;
}
