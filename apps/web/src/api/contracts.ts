import type {
  AuthTokenBody,
  AuthUserBody,
  GameCatalogEntry,
  GameCodeInfo,
  GameMeResponse,
  LeaderboardResponse,
  MatchDetail,
  MatchSummary,
  PaginatedMatchesResponse,
} from "@si-arena/protocol";
import { MATCH_FAILURE_REASONS, resolveResourceLimits } from "@si-arena/protocol";

function check(ok: unknown): asserts ok {
  if (!ok) throw new Error("服务器响应格式有误，请刷新后重试。");
}
export function record(raw: unknown): Record<string, unknown> {
  check(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  return raw as Record<string, unknown>;
}
function string(raw: unknown) {
  check(typeof raw === "string");
}
function number(raw: unknown) {
  check(typeof raw === "number" && Number.isFinite(raw));
}
function integer(raw: unknown) {
  number(raw);
  check(Number.isSafeInteger(raw) && (raw as number) >= 0);
}
function date(raw: unknown) {
  string(raw);
  check(Number.isFinite(Date.parse(raw as string)));
}
function user(raw: unknown) {
  const v = record(raw);
  string(v.id);
  string(v.username);
  check(typeof v.official === "boolean");
}
function stats(raw: unknown) {
  const v = record(raw);
  number(v.rating);
  for (const k of ["matchesPlayed", "wins", "draws", "losses"]) integer(v[k]);
}
function page(raw: unknown) {
  const v = record(raw);
  integer(v.total);
  integer(v.page);
  integer(v.limit);
  check((v.page as number) > 0 && (v.limit as number) > 0);
  return v;
}
export function parseAuthUser(raw: unknown): AuthUserBody {
  user(record(raw).user);
  return raw as AuthUserBody;
}
export function parseAuthToken(raw: unknown): AuthTokenBody {
  parseAuthUser(raw);
  check(typeof record(raw).token === "string" && /^[\w-]{43}$/.test(record(raw).token as string));
  return raw as AuthTokenBody;
}
export function parseGame(raw: unknown): GameCatalogEntry {
  const v = record(raw);
  for (const k of ["id", "name", "description", "release"]) string(v[k]);
  for (const k of ["botProtocolVersion", "minPlayers", "maxPlayers", "maxTicks"]) integer(v[k]);
  record(v.config);
  const resolvedLimits = resolveResourceLimits(record(v.resolvedLimits));
  return { ...(raw as GameCatalogEntry), resolvedLimits };
}
export function parseGames(raw: unknown) {
  const v = record(raw);
  check(Array.isArray(v.games));
  return { games: v.games.map(parseGame) };
}
export function parseUpload(raw: unknown): Omit<GameCodeInfo, "source"> {
  const v = record(raw);
  integer(v.sourceBytes);
  integer(v.botProtocolVersion);
  date(v.updatedAt);
  return raw as Omit<GameCodeInfo, "source">;
}
export function parseGameMe(raw: unknown): GameMeResponse {
  const v = record(raw);
  stats(v.entry);
  check(typeof v.canMatch === "boolean");
  check(
    v.cannotMatchReason === null ||
      ["NO_CODE", "PROTOCOL_MISMATCH", "CODE_TOO_LARGE"].includes(String(v.cannotMatchReason)),
  );
  if (v.code !== null) {
    parseUpload(v.code);
    const code = record(v.code);
    string(code.source);
  }
  if (v.activeMatch !== null) {
    const active = record(v.activeMatch);
    string(active.id);
    check(active.status === "pending" || active.status === "running");
  }
  return raw as GameMeResponse;
}
function summary(raw: unknown): MatchSummary {
  const v = record(raw);
  string(v.id);
  string(v.gameId);
  date(v.createdAt);
  check(["pending", "running", "completed", "failed"].includes(String(v.status)));
  check(Array.isArray(v.participants));
  for (const rawPlayer of v.participants) {
    const p = record(rawPlayer);
    string(p.userId);
    string(p.username);
    check(typeof p.official === "boolean");
    integer(p.slot);
    for (const k of ["rank", "ratingBefore", "ratingAfter"]) if (p[k] !== undefined) number(p[k]);
  }
  return raw as MatchSummary;
}
export function parseMatch(raw: unknown): MatchDetail {
  summary(raw);
  const v = record(raw);
  string(v.release);
  string(v.initiatorId);
  number(v.seed);
  date(v.updatedAt);
  if (v.failureReason !== undefined)
    check(
      MATCH_FAILURE_REASONS.includes(v.failureReason as (typeof MATCH_FAILURE_REASONS)[number]),
    );
  if (v.status === "completed") check(v.result !== undefined);
  if (v.result !== undefined) {
    const r = record(v.result);
    string(r.reason);
    integer(r.completedTicks);
    check(Array.isArray(r.players));
    for (const rawPlayer of r.players) {
      const p = record(rawPlayer);
      string(p.id);
      number(p.rank);
      number(p.score);
    }
  }
  return raw as MatchDetail;
}
export function parseHistory(raw: unknown): PaginatedMatchesResponse {
  const v = page(raw);
  check(Array.isArray(v.matches));
  v.matches.forEach(summary);
  return raw as PaginatedMatchesResponse;
}
export function parseLeaderboard(raw: unknown): LeaderboardResponse {
  const v = page(raw);
  check(Array.isArray(v.players));
  for (const p of v.players) {
    user({ ...record(p), id: record(p).userId });
    stats(p);
    integer(record(p).rank);
  }
  return raw as LeaderboardResponse;
}
