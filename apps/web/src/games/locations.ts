/** Match selection belongs to the game workspace and remains shareable. */
export function gameMatchLocation(gameId: string, matchId?: string) {
  return {
    path: `/games/${encodeURIComponent(gameId)}`,
    query: matchId ? { match: matchId } : {},
  };
}
