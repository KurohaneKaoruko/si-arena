export const TANK_CONFIG = Object.freeze({
  width: 21,
  height: 15,
  initialHp: 3,
  /** Side of the empty square centred on each spawn. */
  spawnClearance: 3,
  /** Percent thresholds of `next() % 100`: below the first is steel, below the second is brick. */
  steelPercent: 8,
  brickPercent: 38,
  /** Whole-map regenerations tried before steel is downgraded to brick. */
  maxGenerations: 20,
} as const);
export const TANK_MAX_TICKS = 600;
export const TANK_PLAYERS = 2;
export const TANK_CELLS = TANK_CONFIG.width * TANK_CONFIG.height;
/** Spawn cell and facing by slot; seeds never swap them. */
export const TANK_SPAWNS = Object.freeze([
  Object.freeze({ x: 1, y: 7, facing: "right" as const }),
  Object.freeze({ x: 19, y: 7, facing: "left" as const }),
] as const);
