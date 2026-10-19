import { MATCH_PAGE_LIMIT_DEFAULT, clampMatchPage, clampMatchPageLimit } from "@si-arena/protocol";

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(requestUrl: string): Pagination {
  const params = new URL(requestUrl, "http://si.arena.local").searchParams;
  const rawPage = params.get("page");
  const rawLimit = params.get("limit");
  // Empty or absent parameters fall back to defaults; anything else is clamped.
  const page = rawPage === null || rawPage === "" ? 1 : clampMatchPage(Number(rawPage));
  const limit =
    rawLimit === null || rawLimit === ""
      ? MATCH_PAGE_LIMIT_DEFAULT
      : clampMatchPageLimit(Number(rawLimit));
  return { page, limit, offset: (page - 1) * limit };
}
