export const BOMBER_CONFIG = Object.freeze({
  width: 15,
  height: 13,
  /** Ticks a bomb lives, counting the settlement that places it. */
  bombFuse: 8,
  initialBombs: 1,
  initialRange: 2,
  maxBombs: 6,
  maxRange: 8,
  /** Percentage of eligible cells that start as soft walls. */
  wallPercent: 70,
  /** Completed tick count at which ring 0 collapses; ring k follows every `collapseInterval`. */
  collapseStart: 300,
  collapseInterval: 8,
} as const);
export const BOMBER_MAX_TICKS = 400;
export const BOMBER_MIN_PLAYERS = 2;
export const BOMBER_MAX_PLAYERS = 4;
export const BOMBER_WIDTH = BOMBER_CONFIG.width;
export const BOMBER_HEIGHT = BOMBER_CONFIG.height;
export const BOMBER_CELLS = BOMBER_WIDTH * BOMBER_HEIGHT;
/** Rings that collapse (0..5); the three centre cells of ring 6 never do. */
export const BOMBER_COLLAPSE_RINGS = 6;

export const CELL_EMPTY = 0;
export const CELL_PILLAR = 1;
export const CELL_WALL = 2;
export const CELL_COLLAPSED = 3;

export const isPillar = (x: number, y: number): boolean => x % 2 === 1 && y % 2 === 1;

/** Smallest distance of a cell to the map edge; ring k collapses k-th. */
export function ringOf(x: number, y: number): number {
  return Math.min(x, BOMBER_WIDTH - 1 - x, y, BOMBER_HEIGHT - 1 - y);
}

/** Rings already collapsed once `tick` ticks are complete. */
export function collapsedRings(tick: number): number {
  if (tick < BOMBER_CONFIG.collapseStart) return 0;
  return Math.min(
    BOMBER_COLLAPSE_RINGS,
    Math.floor((tick - BOMBER_CONFIG.collapseStart) / BOMBER_CONFIG.collapseInterval) + 1,
  );
}
