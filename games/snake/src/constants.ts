export const SNAKE_CONFIG = Object.freeze({
  /** Segments at spawn, stacked on the spawn cell. */
  initialLength: 3,
  /** Health at spawn and after eating; it drops by one every tick. */
  maxHealth: 100,
  /** Chance in percent that a spawn step places a second piece of food. */
  extraFoodPercent: 15,
} as const);
export const SNAKE_MAX_TICKS = 500;
export const SNAKE_MIN_PLAYERS = 2;
export const SNAKE_MAX_PLAYERS = 4;

/** Side of the square map for a player count: 2→15, 3→17, 4→19. */
export function snakeMapSize(players: number): number {
  return 11 + 2 * players;
}
