import type { GameResult } from "./game";
import type { JsonObject } from "./json";
import type { ResourceLimits } from "./resources";

export type MatchStatus = "pending" | "running" | "completed" | "failed";

/**
 * Controlled failure reasons for failed matches, written by the worker and
 * surfaced verbatim in match details.
 */
export const MATCH_FAILURE_REASONS = [
  "ENTRY_CHANGED_BEFORE_START",
  "WORKER_LOST",
  "EXECUTION_FAILED",
] as const;

export type MatchFailureReason = (typeof MATCH_FAILURE_REASONS)[number];

/** Why an otherwise authenticated user cannot initiate a match for a game right now. */
export type CannotMatchReason = "NO_CODE" | "PROTOCOL_MISMATCH" | "CODE_TOO_LARGE";

export const MATCH_PAGE_LIMIT_MIN = 1;
export const MATCH_PAGE_LIMIT_DEFAULT = 50;
export const MATCH_PAGE_LIMIT_MAX = 100;

export interface MatchParticipantSummary {
  userId: string;
  username: string;
  official: boolean;
  slot: number;
  rank?: number;
  ratingBefore?: number;
  ratingAfter?: number;
}

export interface MatchSummary {
  id: string;
  gameId: string;
  status: MatchStatus;
  createdAt: string;
  participants: MatchParticipantSummary[];
}

export interface MatchDetail extends MatchSummary {
  release: string;
  seed: number;
  initiatorId: string;
  result?: GameResult;
  failureReason?: MatchFailureReason;
  updatedAt: string;
}

export interface GameCodeInfo {
  source: string;
  sourceBytes: number;
  botProtocolVersion: number;
  updatedAt: string;
}

export interface GameEntryStats {
  rating: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface GameMeResponse {
  entry: GameEntryStats;
  code: GameCodeInfo | null;
  canMatch: boolean;
  cannotMatchReason: CannotMatchReason | null;
  /** Only the user's unfinished initiated request; passive participations do not block matching. */
  activeMatch: { id: string; status: "pending" | "running" } | null;
}

export interface LeaderboardPlayer {
  rank: number;
  userId: string;
  username: string;
  official: boolean;
  rating: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface LeaderboardResponse {
  total: number;
  page: number;
  limit: number;
  players: LeaderboardPlayer[];
}

export interface PaginatedMatchesResponse {
  total: number;
  page: number;
  limit: number;
  matches: MatchSummary[];
}

/** Frozen at match creation; the worker never re-resolves current releases. */
export interface FrozenGameRelease {
  gameId: string;
  release: string;
  config: JsonObject;
  resolvedLimits: ResourceLimits;
  botProtocolVersion: number;
}

/** Upper bound keeps (page - 1) * limit far inside PostgreSQL's offset range. */
export const MATCH_PAGE_MAX = 1_000_000;

export function clampMatchPageLimit(value: number): number {
  if (!Number.isFinite(value)) return MATCH_PAGE_LIMIT_DEFAULT;
  return Math.min(MATCH_PAGE_LIMIT_MAX, Math.max(MATCH_PAGE_LIMIT_MIN, Math.round(value)));
}

export function clampMatchPage(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MATCH_PAGE_MAX, Math.max(1, Math.round(value)));
}
