/** Match selection belongs to the game workspace and remains shareable. */
export function gameMatchLocation(gameId: string, matchId?: string) {
  return {
    path: `/games/${encodeURIComponent(gameId)}`,
    query: matchId ? { match: matchId } : {},
  };
}

/** The shared arena page of a game that declares one in its manifest. */
export function gameArenaPath(gameId: string): string {
  return `/games/${encodeURIComponent(gameId)}/arena`;
}
