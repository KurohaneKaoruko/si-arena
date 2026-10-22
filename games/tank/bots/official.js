/**
 * Official example bot for 坦克对决 (tank).
 *
 * One opponent, three hit points each, bullets that fly two cells per tick and
 * cancel each other head-on. The bot survives first and shoots second:
 *
 * - Dodge: an enemy bullet on the own row or column, flying towards the bot,
 *   within 4 cells and with nothing between, is sidestepped by one cell
 *   perpendicular to its flight. Moves settle before bullets fly, so one step
 *   is always in time. With no free side cell the bot fires back when it faces
 *   the bullet, which cancels it.
 * - Duel: aligned with the opponent and no steel between, the bot turns to
 *   face it. A shot from 2 cells or nearer lands in the same tick; from
 *   farther away the opponent sees the bullet and can step aside, so the bot
 *   only fires when the shot is sure, when bricks in the lane need clearing,
 *   or when the opponent has no side cell to dodge into. Otherwise it advances
 *   along the lane.
 * - Stand-offs: two tanks facing each other with ready guns cancel every
 *   exchange, and two tanks chasing each other around a pillar or blocking
 *   each other's step never meet. One of them, the "leader", breaks the
 *   pattern: it leaves the lane, goes the other way round, or takes a detour.
 *   The leader is chosen by comparing the two positions, with the side flipped
 *   by the parity of the steel count in the upper half of the map so it is not
 *   always the same seat; in a stand-off the role falls to whichever tank can
 *   actually step aside.
 * - Approach: otherwise it walks the cheapest path to the opponent, counting a
 *   brick as 3 steps and steel as impassable, and shoots a brick that blocks
 *   the next step. Cells the opponent could shoot in the same tick cost extra.
 *   The path is kept in Memory and only recomputed when it breaks or the
 *   opponent moves away from where it led, so the chase does not flip between
 *   equal routes every tick.
 *
 * The bot uses the same observation, SDK, Memory and limits as every player.
 * Every search is bounded by the 315-cell map, so a tick costs at most a few
 * milliseconds.
 */

const DIRECTIONS = ["up", "right", "down", "left"];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const FAR = 30000;
const BRICK_COST = 3;
const DANGER_COST = 4;
/** Enemy bullets this close on the own line trigger a sidestep. */
const DODGE_RANGE = 4;
/** A shot from this distance or nearer lands before the target can move. */
const SURE_RANGE = 2;
/** Farthest shot taken at bricks or at a cornered opponent. */
const FIRE_RANGE = 6;
/** Ticks without moving after which the leader takes a detour. */
const STUCK_TICKS = 2;
/** A planned path is kept while the opponent stays within this many cells of its goal. */
const REPLAN_DISTANCE = 3;
/** Positions remembered to notice a chase going round in circles. */
const HISTORY = 16;

const FIRE = 4;
const IDLE = -1;

export default function tick({ game, Memory }) {
  if (!game.opponent) return game.self.idle();
  const o = survey(game);
  const action = decide(o, Memory);
  if (action === FIRE) game.self.fire();
  else if (action >= 0) game.self.move(DIRECTIONS[action]);
  else game.self.idle();
}

function survey(game) {
  const { width, height, cells } = game.board;
  const me = game.self;
  const opp = game.opponent;
  let steelAbove = 0;
  for (let cell = 0; cell < (height >> 1) * width; cell++) if (cells[cell] === 2) steelAbove++;
  return {
    width,
    height,
    cells,
    me,
    opp,
    bullets: game.bullets,
    meFacing: DIRECTIONS.indexOf(me.facing),
    oppFacing: DIRECTIONS.indexOf(opp.facing),
    flip: steelAbove % 2 === 1,
    // Tie-break order of directions, rotated for seat 1 so that both seats play the
    // point-symmetric map the same way and neither side is favoured.
    order: me.slot === 0 ? [0, 1, 2, 3] : [2, 3, 0, 1],
  };
}

function decide(o, Memory) {
  const here = o.me.position.y * o.width + o.me.position.x;
  const history = Array.isArray(Memory.history) ? Memory.history : [];
  const stuck =
    history.length && history[history.length - 1] === here ? (Memory.stuck ?? 0) + 1 : 0;
  const circling = history.filter((cell) => cell === here).length >= 2;
  history.push(here);
  Memory.history = history.slice(-HISTORY);
  Memory.stuck = stuck;

  const threat = incoming(o);
  if (threat >= 0) return dodge(o, threat);
  const lane = laneTo(o, o.me.position, o.opp.position);
  let action = IDLE;
  if (lane) action = duel(o, lane);
  if (action === IDLE) {
    // The leader breaks a chase in circles by banning its next step and going round
    // the other way; the plan and history restart so the new route is given time.
    if (circling && leader(o)) {
      const plan = Array.isArray(Memory.plan) ? Memory.plan : [];
      const at = plan.indexOf(here);
      Memory.plan = [];
      Memory.history = [];
      action = approach(o, Memory, at >= 0 && at + 1 < plan.length ? plan[at + 1] : -1);
    } else action = approach(o, Memory, -1);
  }
  // Two deterministic tanks can block each other's step every tick; after a few ticks
  // without moving the leader steps somewhere else.
  if (action !== FIRE && stuck >= STUCK_TICKS && leader(o)) {
    const alternative = detour(o, action, stuck);
    if (alternative !== IDLE) action = alternative;
  }
  return action;
}

function inside(o, x, y) {
  return x >= 0 && y >= 0 && x < o.width && y < o.height;
}
function cellAt(o, x, y) {
  return inside(o, x, y) ? o.cells[y * o.width + x] : 2;
}
/** A cell a tank may step into: on the map, empty and not occupied by the other tank. */
function free(o, x, y, other) {
  return cellAt(o, x, y) === 0 && !(x === other.position.x && y === other.position.y);
}

/**
 * Direction index from `from` to `to` when they share a row or column with no steel
 * between, with the distance and the number of bricks in between; null otherwise.
 */
function laneTo(o, from, to) {
  if (from.x !== to.x && from.y !== to.y) return null;
  const dir = from.y === to.y ? (to.x > from.x ? 1 : 3) : to.y > from.y ? 2 : 0;
  const dist = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  let bricks = 0;
  for (let step = 1; step < dist; step++) {
    const cell = cellAt(o, from.x + DX[dir] * step, from.y + DY[dir] * step);
    if (cell === 2) return null;
    if (cell === 1) bricks++;
  }
  return { dir, dist, bricks };
}

/** Direction index an enemy bullet flies in when it threatens the own cell, else -1. */
function incoming(o) {
  const { x, y } = o.me.position;
  for (const bullet of o.bullets) {
    if (bullet.ownerSlot === o.me.slot) continue;
    const dir = DIRECTIONS.indexOf(bullet.direction);
    const dist = (x - bullet.position.x) * DX[dir] + (y - bullet.position.y) * DY[dir];
    const onLine = DX[dir] !== 0 ? bullet.position.y === y : bullet.position.x === x;
    if (!onLine || dist <= 0 || dist > DODGE_RANGE) continue;
    let clear = true;
    for (let step = 1; step < dist && clear; step++)
      if (cellAt(o, bullet.position.x + DX[dir] * step, bullet.position.y + DY[dir] * step) !== 0)
        clear = false;
    if (clear) return dir;
  }
  return -1;
}

/** Step out of the bullet's line, preferring a cell the opponent cannot shoot at once. */
function dodge(o, bulletDir) {
  let best = IDLE;
  let bestScore = -FAR;
  for (const dir of o.order) {
    if (DX[dir] === DX[bulletDir] && DY[dir] === DY[bulletDir]) continue;
    if (DX[dir] === -DX[bulletDir] && DY[dir] === -DY[bulletDir]) continue;
    const x = o.me.position.x + DX[dir];
    const y = o.me.position.y + DY[dir];
    if (!free(o, x, y, o.opp)) continue;
    const score = exposed(o, x, y) ? 0 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }
  if (best !== IDLE) return best;
  if (!o.me.bulletInFlight && o.meFacing === (bulletDir + 2) % 4) return FIRE;
  return IDLE;
}

/** Whether a tank facing a cell within sure range over a clear lane could hit it now. */
function covered(o, shooter, shooterFacing, x, y) {
  const lane = laneTo(o, shooter.position, { x, y });
  return (
    lane !== null && lane.dir === shooterFacing && lane.dist <= SURE_RANGE && lane.bricks === 0
  );
}
function exposed(o, x, y) {
  return covered(o, o.opp, o.oppFacing, x, y);
}

/** The tank that breaks symmetric patterns: decided by position order, flipped per map. */
function leader(o) {
  const a = o.me.position;
  const b = o.opp.position;
  const smaller = a.x < b.x || (a.x === b.x && a.y < b.y);
  return smaller !== o.flip;
}

/** A side cell `tank` could leave the lane into without being shot by `other` at once. */
function sideStep(o, laneDir, tank, other, otherFacing) {
  for (const dir of [(laneDir + 3) % 4, (laneDir + 1) % 4]) {
    const x = tank.position.x + DX[dir];
    const y = tank.position.y + DY[dir];
    if (free(o, x, y, other) && !covered(o, other, otherFacing, x, y)) return dir;
  }
  return IDLE;
}

function duel(o, lane) {
  if (o.meFacing !== lane.dir) return lane.dir;
  const ready = !o.me.bulletInFlight;
  const oppFacingMe = o.oppFacing === (lane.dir + 2) % 4;
  const standOff = oppFacingMe && !o.opp.bulletInFlight;
  if (standOff) {
    // Whoever leads leaves the lane; if it cannot, the other one does.
    const mine = sideStep(o, lane.dir, o.me, o.opp, o.oppFacing);
    const theirs = sideStep(o, (lane.dir + 2) % 4, o.opp, o.me, o.meFacing);
    if (mine !== IDLE && (leader(o) || theirs === IDLE)) return mine;
  }
  const cornered = [(lane.dir + 1) % 4, (lane.dir + 3) % 4].every(
    (dir) => !free(o, o.opp.position.x + DX[dir], o.opp.position.y + DY[dir], o.me),
  );
  if (ready) {
    if (lane.dist <= SURE_RANGE) return FIRE;
    if (lane.dist <= FIRE_RANGE && (lane.bricks > 0 || cornered)) return FIRE;
  }
  const ahead = cellAt(o, o.me.position.x + DX[lane.dir], o.me.position.y + DY[lane.dir]);
  if (ahead === 1) return ready ? FIRE : IDLE;
  // Walking into the opponent's sure range while it faces the bot with a ready gun
  // only trades shots; the approach search finds a flank instead.
  if (ahead === 0 && !(standOff && lane.dist - 1 <= SURE_RANGE)) return lane.dir;
  return IDLE;
}

/** Some other free, unexposed step than `avoid`, starting from a rotating direction. */
function detour(o, avoid, offset) {
  for (let turn = 0; turn < 4; turn++) {
    const dir = o.order[(offset + turn) % 4];
    if (dir === avoid) continue;
    const x = o.me.position.x + DX[dir];
    const y = o.me.position.y + DY[dir];
    if (free(o, x, y, o.opp) && !exposed(o, x, y)) return dir;
  }
  return IDLE;
}

/**
 * Walk the planned path to the opponent, firing at a brick in the way. The path is kept in
 * Memory and only recomputed when it is broken, finished, exposed or the opponent has moved
 * away from its goal. `banned` is a cell the new plan must not pass through.
 */
function approach(o, Memory, banned) {
  const { width, cells } = o;
  const goal = o.opp.position.y * width + o.opp.position.x;
  const start = o.me.position.y * width + o.me.position.x;
  let plan = Array.isArray(Memory.plan) ? Memory.plan : [];
  const at = plan.indexOf(start);
  let next = at >= 0 && at + 1 < plan.length ? plan[at + 1] : -1;
  const goalMoved =
    typeof Memory.goal !== "number" || manhattan(o, Memory.goal, goal) > REPLAN_DISTANCE;
  if (
    next < 0 ||
    goalMoved ||
    cells[next] === 2 ||
    exposed(o, next % width, (next / width) | 0) ||
    (next === goal && at + 1 < plan.length - 1)
  ) {
    plan = findPath(o, start, goal, banned);
    Memory.plan = plan;
    Memory.goal = goal;
    next = plan.length > 1 ? plan[1] : -1;
  }
  if (next < 0) return IDLE;
  const dir = directionTo(o, start, next);
  if (cells[next] === 1) return o.meFacing === dir && !o.me.bulletInFlight ? FIRE : dir;
  return dir;
}

function manhattan(o, a, b) {
  return (
    Math.abs((a % o.width) - (b % o.width)) + Math.abs(((a / o.width) | 0) - ((b / o.width) | 0))
  );
}

/**
 * Cheapest path from start to goal as a list of cells: empty cells cost 1, bricks 3, cells
 * the opponent can shoot at once 4 more, steel and the banned cell are impassable. Empty
 * when the goal is unreachable.
 */
function findPath(o, start, goal, banned) {
  const { width, height, cells } = o;
  const size = width * height;
  const dist = new Int32Array(size).fill(FAR);
  const parent = new Int32Array(size).fill(-1);
  const buckets = [];
  dist[start] = 0;
  buckets[0] = [start];
  for (let cost = 0; cost < buckets.length && dist[goal] === FAR; cost++) {
    const bucket = buckets[cost];
    if (!bucket) continue;
    for (const cell of bucket) {
      if (dist[cell] !== cost) continue;
      const x = cell % width;
      const y = (cell / width) | 0;
      for (const dir of o.order) {
        const nx = x + DX[dir];
        const ny = y + DY[dir];
        if (!inside(o, nx, ny)) continue;
        const next = ny * width + nx;
        const terrain = cells[next];
        if (terrain === 2 || next === banned) continue;
        const step = (terrain === 1 ? BRICK_COST : 1) + (exposed(o, nx, ny) ? DANGER_COST : 0);
        if (cost + step >= dist[next]) continue;
        dist[next] = cost + step;
        parent[next] = cell;
        (buckets[cost + step] ??= []).push(next);
      }
    }
  }
  if (dist[goal] >= FAR) return [];
  const path = [];
  for (let cell = goal; cell >= 0; cell = parent[cell]) path.push(cell);
  return path.reverse();
}

function directionTo(o, from, to) {
  const dx = (to % o.width) - (from % o.width);
  const dy = ((to / o.width) | 0) - ((from / o.width) | 0);
  for (let dir = 0; dir < 4; dir++) if (DX[dir] === dx && DY[dir] === dy) return dir;
  return IDLE;
}
