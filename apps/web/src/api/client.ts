export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public matchId?: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export async function checkedResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => null);
  const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  throw new ApiError(
    response.status,
    typeof value.code === "string" ? value.code : "HTTP_ERROR",
    typeof value.message === "string" ? value.message : `请求失败（${response.status}）`,
    typeof value.matchId === "string" ? value.matchId : undefined,
    Number(response.headers.get("Retry-After")) || undefined,
  );
}

export async function apiRequest<T>(
  path: string,
  parse: (raw: unknown) => T,
  options: RequestInit = {},
): Promise<T> {
  const response = await checkedResponse(await fetch(path, { ...options, cache: "no-store" }));
  return parse(response.status === 204 ? undefined : await response.json());
}
export function jsonBody(value: unknown) {
  return { body: JSON.stringify(value), headers: { "Content-Type": "application/json" } };
}
export function noContent(raw: unknown): void {
  if (raw !== undefined) throw new Error("服务器响应格式有误");
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return error.message + (error.retryAfter ? `，请在 ${error.retryAfter} 秒后重试。` : "");
  if (error instanceof TypeError) return "网络连接失败，请检查连接后重试。";
  return error instanceof Error ? error.message : "请求失败，请重试。";
}
