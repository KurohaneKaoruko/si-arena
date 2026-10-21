// @ts-check
/** @param {import("@si-arena/game-royale/sdk").RoyaleTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  // Choose one direction yourself. Pathfinding, the safe zone and risk belong to your bot.
  const { x } = game.self.position;
  if (x + 1 < game.zone.min.x + game.zone.size) game.self.move("right");
  else game.self.idle();
}
