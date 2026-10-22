// @ts-check
/** @param {import("@si-arena/game-tank/sdk").TankTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  // Decide yourself when to move, turn and fire. Dodging and pathfinding belong to your bot.
  const { self, opponent } = game;
  if (opponent && opponent.position.y === self.position.y && !self.bulletInFlight) {
    const direction = opponent.position.x > self.position.x ? "right" : "left";
    if (self.facing === direction) game.self.fire();
    else game.self.move(direction);
  } else game.self.move("up");
}
