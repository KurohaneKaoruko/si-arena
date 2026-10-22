// @ts-check
/** @param {import("@si-arena/game-snake/sdk").SnakeTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  // Choose one direction yourself. Food, other snakes and open space belong to your bot.
  const { head, heading } = game.self;
  const { width, height } = game.board;
  const open = {
    up: head.y > 0,
    right: head.x + 1 < width,
    down: head.y + 1 < height,
    left: head.x > 0,
  };
  const reverse = { up: "down", right: "left", down: "up", left: "right" };
  const choice = open[heading]
    ? heading
    : /** @type {const} */ (["up", "right", "down", "left"]).find(
        (direction) => open[direction] && direction !== reverse[heading],
      );
  game.self.move(choice ?? heading);
}
