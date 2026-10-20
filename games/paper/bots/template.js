// @ts-check
/** @param {import("@si-arena/game-paper/sdk").PaperTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  // Choose one direction yourself. Pathfinding and risk assessment belong to your bot.
  if (game.self.position.x + 1 < game.board.width) game.self.move("right");
  else game.self.idle();
}
