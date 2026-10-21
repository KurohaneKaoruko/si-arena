export const ROYALE_CONFIG = Object.freeze({
  /** Cells budgeted per player for the map side and the safe-zone target. */
  cellsPerPlayer: 320,
  minMapSize: 20,
  minZoneSize: 10,
  /** The zone shrinks by one ring on every tick number that is a multiple of this. */
  shrinkInterval: 10,
  initialTerritorySize: 3,
} as const);
export const ROYALE_MAX_TICKS = 800;
export const ROYALE_MIN_PLAYERS = 2;
export const ROYALE_MAX_PLAYERS = 5;

/** Side of the square map for a player count: 2→26, 3→31, 4→36, 5→40. */
export function royaleMapSize(players: number): number {
  return Math.max(
    ROYALE_CONFIG.minMapSize,
    Math.ceil(Math.sqrt(ROYALE_CONFIG.cellsPerPlayer * players)),
  );
}

/** Safe-zone side the zone shrinks towards while this many players are alive. */
export function royaleZoneTarget(alive: number): number {
  return Math.max(
    ROYALE_CONFIG.minZoneSize,
    Math.ceil(Math.sqrt(ROYALE_CONFIG.cellsPerPlayer * alive)),
  );
}
