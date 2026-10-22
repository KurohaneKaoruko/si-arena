/**
 * Official example bot for 贪吃蛇大作战 (snake).
 *
 * A dead snake is out for good, so the bot is careful first and greedy second:
 *
 * - Every tick it marks the cells that will be occupied after this move: every
 *   segment of every snake except a tail that moves away. A tail stays put when
 *   it is still stacked on the spawn cell or when its owner stands next to food
 *   and may eat this tick, so those tails count as occupied.
 * - Cells next to the head of an opponent that is at least as long as the bot
 *   are threatened: a head-on meeting there kills the bot (or both snakes).
 * - Each of the four directions is scored by a flood fill from its target cell
 *   over the free cells (the room the bot would keep) and by the distance to the
 *   nearest food found by the same search. Food that an opponent at least as
 *   long reaches no later than the bot is contested and only counts when no
 *   other food is reachable, so two equal snakes do not circle one piece until
 *   both starve.
 * - While health is below 40, or while some opponent is at least as long, food
 *   wins over room; otherwise the bot keeps the largest open area and drifts to
 *   food only as a tie-breaker. Room smaller than the bot's own length is a trap
 *   and is heavily penalised.
 * - Off-map, occupied and threatened targets are penalised in that order, so
 *   when nothing is safe the bot still picks the least fatal direction.
 * - Equal scores resolve by direction order (up, right, down, left).
 *
 * The bot uses the same observation, SDK, Memory and limits as every player.
 * Four flood fills over a 19×19 board cost well under a millisecond.
 */

const DIRECTIONS = ["up", "right", "down", "left"];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
/** Health below which food matters more than room. */
const HUNGRY_HEALTH = 40;

export default function tick({ game }) {
  const { width, height } = game.board;
  const size = width * height;
  const me = game.self;
  const index = (cell) => cell.y * width + cell.x;
  const food = new Uint8Array(size);
  for (const cell of game.food) food[index(cell)] = 1;
  const nextToFood = (head) => {
    for (let d = 0; d < 4; d++) {
      const x = head.x + DX[d];
      const y = head.y + DY[d];
      if (x >= 0 && y >= 0 && x < width && y < height && food[y * width + x]) return true;
    }
    return false;
  };
  // Cells occupied once every tail has moved.
  const blocked = new Uint8Array(size);
  for (const snake of [me, ...game.opponents]) {
    const body = snake.body;
    const last = body[body.length - 1];
    const before = body[body.length - 2];
    const stacked = last.x === before.x && last.y === before.y;
    // The bot's own tail cannot hold food, so it always moves unless stacked.
    const keeps =
      stacked || (snake !== me && nextToFood(snake.head)) ? body.length : body.length - 1;
    for (let i = 0; i < keeps; i++) blocked[index(body[i])] = 1;
  }
  // Cells a head at least as long as ours can enter this tick.
  const threatened = new Uint8Array(size);
  for (const other of game.opponents) {
    if (other.length < me.length) continue;
    for (let d = 0; d < 4; d++) {
      const x = other.head.x + DX[d];
      const y = other.head.y + DY[d];
      if (x >= 0 && y >= 0 && x < width && y < height) threatened[y * width + x] = 1;
    }
  }
  const hungry =
    me.health < HUNGRY_HEALTH || game.opponents.some((other) => other.length >= me.length);
  // Steps an opponent at least as long needs to reach each food cell.
  const rivalDistance = new Int32Array(size).fill(size);
  for (const other of game.opponents) {
    if (other.length < me.length) continue;
    for (const cell of game.food) {
      const steps = Math.abs(cell.x - other.head.x) + Math.abs(cell.y - other.head.y);
      const at = index(cell);
      if (steps < rivalDistance[at]) rivalDistance[at] = steps;
    }
  }
  const queue = new Int32Array(size);
  const seen = new Uint8Array(size);
  let best = DIRECTIONS.indexOf(me.heading);
  let bestScore = -Infinity;
  for (let d = 0; d < 4; d++) {
    const x = me.head.x + DX[d];
    const y = me.head.y + DY[d];
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const start = y * width + x;
    let score = 0;
    if (blocked[start]) score -= 1000000;
    if (threatened[start]) score -= 100000;
    // Flood fill the room beyond the target; the first food met is the nearest one.
    seen.fill(0);
    const distance = new Int32Array(size);
    let length = 0;
    let foodDistance = -1;
    let contestedDistance = -1;
    seen[start] = 1;
    queue[length++] = start;
    for (let cursor = 0; cursor < length; cursor++) {
      const cell = queue[cursor];
      if (food[cell]) {
        // The bot stands one step before `start`; a rival no farther away contests the food.
        if (rivalDistance[cell] > distance[cell] + 1) {
          if (foodDistance < 0) foodDistance = distance[cell];
        } else if (contestedDistance < 0) contestedDistance = distance[cell];
      }
      const cx = cell % width;
      const cy = (cell - cx) / width;
      for (let e = 0; e < 4; e++) {
        const nx = cx + DX[e];
        const ny = cy + DY[e];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (seen[next] || blocked[next]) continue;
        seen[next] = 1;
        distance[next] = distance[cell] + 1;
        queue[length++] = next;
      }
    }
    const room = length;
    if (room < me.length) score -= 5000;
    score += room * (hungry ? 1 : 10);
    const target = foodDistance >= 0 ? foodDistance : contestedDistance;
    if (target >= 0) score -= target * (hungry ? 20 : 1);
    else score -= size;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  game.self.move(DIRECTIONS[best]);
}
