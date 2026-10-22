// @ts-check
/** @param {import("@si-arena/game-bomber/sdk").BomberTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  // Choose one action yourself. Predicting flames, escaping and bombing walls belong to your bot.
  const { x, y } = game.self.position;
  const { width, cells } = game.board;
  if (x + 1 < width && cells[y * width + x + 1] === 0) game.self.move("right");
  else game.self.idle();
}
