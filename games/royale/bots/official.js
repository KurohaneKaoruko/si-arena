/**
 * Official example bot for 圈地大逃杀 (royale).
 *
 * Up to five players share the map and a dead player is out for good, so the
 * bot is careful first and greedy second:
 *
 * - Every tick it measures, by breadth-first search from all opponent heads,
 *   how many moves the nearest opponent needs to reach each cell of the safe
 *   zone. A trail cell is only ever exposed while the bot needs fewer ticks to
 *   close than any opponent needs to reach it.
 * - It grows its territory with small rectangular loops anchored on its own
 *   border: out along d1, across along d2, back along -d1, home along -d2. A
 *   loop is only started, and only continued, while no opponent can reach any
 *   of its trail cells before it closes. Otherwise the bot runs home.
 * - Cells that the safe zone will drop before the loop closes are never used.
 *   The zone shrinks on tick numbers that are multiples of 10 while it is
 *   larger than its target, and one more ring is treated as doomed whenever a
 *   death could lower the target.
 * - Cells an opponent would enclose if it closed its trail right now are
 *   avoided as well, since a trail on a cell another player claims dies.
 * - It steps on an opponent trail whenever it gets there no later than that
 *   opponent can close, without exposing its own trail. That eliminates the
 *   opponent.
 * - It never steps on its own trail, off the map or out of the zone, and keeps
 *   away from cells another head could enter on the same tick.
 *
 * The bot uses the same observation, SDK, Memory and limits as every player.
 * Every search is bounded by the map size, so a tick costs a few milliseconds.
 */

const DIRECTIONS = ["up", "right", "down", "left"];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const FAR = 30000;
/** A trail owner that never occurs, for searches that no trail blocks. */
const NO_SLOT = -2;
const SHRINK_INTERVAL = 10;
/** Leg lengths a loop may use; the planner scores every combination. */
const SIZES = [2, 3, 4, 6, 8, 10];
/** Border cells per direction considered as loop anchors, nearest first. */
const ANCHORS_PER_DIRECTION = 2;
/** Longest walk inside the own territory before a loop starts. */
const MAX_WALK = 16;
/** Divisor that turns a loop into a score per tick spent. */
const TIME_WEIGHT = 20;
/** Spare ticks below which a loop loses score, and the score lost per missing tick. */
const RISK_SLACK = 4;
const RISK_STEP = 3;
/** Farthest opponent trail the bot walks to. */
const HUNT_RANGE = 16;

export default function tick({ game, Memory }) {
  const o = survey(game);
  const direction = decide(o, Memory);
  if (direction < 0) game.self.idle();
  else game.self.move(DIRECTIONS[direction]);
}

function decide(o, Memory) {
  const stored = Array.isArray(Memory.plan) ? Memory.plan : [];
  Memory.plan = [];
  const hunt = findHunt(o);
  if (hunt >= 0) return hunt;
  const closes = planTime(o, stored);
  if (closes > 0) {
    Memory.plan = stored.slice(1, closes);
    return directionTo(o, stored[0]);
  }
  if (o.outside) return goHome(o);
  const plan = planLoop(o);
  if (plan) {
    Memory.plan = plan.slice(1);
    return directionTo(o, plan[0]);
  }
  return rest(o);
}

/** What every decision needs, measured once from the current observation. */
function survey(game) {
  const width = game.board.width;
  const size = width * width;
  const territory = game.board.territory;
  const trails = game.board.trails;
  const me = game.self.slot;
  const zone = game.zone;
  const zoneMin = zone.min.x;
  const zoneMax = zoneMin + zone.size - 1;
  // Rings that may leave the zone: the scheduled shrinks, plus one more while a
  // death could lower the target (with two players a death ends the game).
  const scheduled = zone.ticksToNextShrink === null ? 0 : Math.ceil((zone.size - zone.target) / 2);
  const doomed = scheduled + (game.opponents.length > 1 ? 1 : 0);
  const nextShrink = SHRINK_INTERVAL - (game.tick % SHRINK_INTERVAL);
  const o = {
    width,
    size,
    adjacent: neighbours(width),
    territory,
    trails,
    me,
    head: game.self.position.y * width + game.self.position.x,
    outside: false,
    /** Moves after which a cell is outside the zone: 0 outside now, FAR when safe. */
    expire: new Int16Array(size),
    myTrail: [],
    opponents: [],
    /** Fewest moves any opponent head needs to reach a cell. */
    oppDist: new Int16Array(size),
    /** Cells some opponent would claim by closing its trail now. */
    danger: new Uint8Array(size),
    queue: new Int32Array(size),
    homeDist: null,
  };
  o.outside = territory[o.head] !== me;
  const trailOf = [];
  // Box around each opponent's land and trail: [left, top, right, bottom].
  const boxes = [];
  for (const p of game.opponents) {
    trailOf[p.slot] = [];
    boxes[p.slot] = [width, width, -1, -1];
  }
  for (let y = 0, cell = 0; y < width; y++) {
    const rowRing = y - zoneMin < zoneMax - y ? y - zoneMin : zoneMax - y;
    for (let x = 0; x < width; x++, cell++) {
      const columnRing = x - zoneMin < zoneMax - x ? x - zoneMin : zoneMax - x;
      const ring = rowRing < columnRing ? rowRing : columnRing;
      o.expire[cell] = ring < 0 ? 0 : ring < doomed ? nextShrink + SHRINK_INTERVAL * ring : FAR;
      const owner = trails[cell];
      const land = territory[cell];
      if (owner === me) o.myTrail.push(cell);
      else if (owner >= 0) trailOf[owner].push(cell);
      if (land >= 0 && land !== me) grow(boxes[land], x, y);
      if (owner >= 0 && owner !== me && owner !== land) grow(boxes[owner], x, y);
    }
  }
  for (const p of game.opponents) {
    const head = p.position.y * width + p.position.x;
    o.opponents.push({ slot: p.slot, head, trail: trailOf[p.slot] });
    if (trailOf[p.slot].length > 0) markClaims(o, p.slot, boxes[p.slot]);
  }
  // Ignoring that opponents cannot cross their own trails only makes these
  // distances shorter, so every check against them stays on the safe side.
  bfs(
    o,
    o.opponents.map((p) => p.head),
    o.oppDist,
    NO_SLOT,
    FAR,
    null,
  );
  return o;
}

function grow(box, x, y) {
  if (x < box[0]) box[0] = x;
  if (y < box[1]) box[1] = y;
  if (x > box[2]) box[2] = x;
  if (y > box[3]) box[3] = y;
}

/**
 * Neighbour table of a map width, cell * 4 + direction, -1 off the map. It is
 * a cache in a global, which the sandbox keeps between successful ticks.
 */
let cachedGrid = null;
function neighbours(width) {
  if (!cachedGrid || cachedGrid.width !== width) {
    const size = width * width;
    const table = new Int32Array(size * 4);
    for (let cell = 0; cell < size; cell++) {
      const x = cell % width;
      const y = (cell / width) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        table[cell * 4 + d] = nx < 0 || ny < 0 || nx >= width || ny >= width ? -1 : ny * width + nx;
      }
    }
    cachedGrid = { width, table };
  }
  return cachedGrid.table;
}

/**
 * Breadth-first distances up to `limit` from the sources over cells inside the
 * zone that are not trail of `blockedSlot`. `parent` records where each came from.
 * Returns how many cells were reached; o.queue lists them nearest first.
 */
function bfs(o, sources, dist, blockedSlot, limit, parent) {
  const { adjacent, trails, expire, queue } = o;
  dist.fill(FAR);
  let length = 0;
  for (const source of sources) {
    dist[source] = 0;
    queue[length++] = source;
  }
  for (let cursor = 0; cursor < length; cursor++) {
    const cell = queue[cursor];
    const next = dist[cell] + 1;
    if (next > limit) break;
    for (let k = cell * 4, end = k + 4; k < end; k++) {
      const target = adjacent[k];
      if (target < 0 || dist[target] !== FAR || expire[target] === 0) continue;
      if (trails[target] === blockedSlot) continue;
      dist[target] = next;
      if (parent) parent[target] = cell;
      queue[length++] = target;
    }
  }
  return length;
}

/**
 * Mark what an opponent would claim by closing now: cells cut off from the map
 * edge by its land and trail that are not its land yet. Nothing outside the box
 * around its land and trail can be cut off, so the fill stays inside that box
 * grown by one cell, whose rim is open or the map edge itself.
 */
function markClaims(o, slot, box) {
  const { width, adjacent, territory, trails, queue, danger } = o;
  const left = Math.max(box[0] - 1, 0);
  const top = Math.max(box[1] - 1, 0);
  const right = Math.min(box[2] + 1, width - 1);
  const bottom = Math.min(box[3] + 1, width - 1);
  // 0 outside the box, 1 open inside it, 2 reached from its rim.
  const state = new Uint8Array(o.size);
  let length = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = left, cell = y * width + left; x <= right; x++, cell++) {
      if (territory[cell] === slot || trails[cell] === slot) continue;
      if (y !== top && y !== bottom && x !== left && x !== right) state[cell] = 1;
      else {
        state[cell] = 2;
        queue[length++] = cell;
      }
    }
  }
  for (let cursor = 0; cursor < length; cursor++) {
    for (let k = queue[cursor] * 4, end = k + 4; k < end; k++) {
      const next = adjacent[k];
      if (next < 0 || state[next] !== 1) continue;
      state[next] = 2;
      queue[length++] = next;
    }
  }
  for (let y = top; y <= bottom; y++)
    for (let x = left, cell = y * width + left; x <= right; x++, cell++) {
      if (state[cell] !== 2 && territory[cell] !== slot) danger[cell] = 1;
    }
}

/** Moves from each cell back to the own territory without crossing the own trail. */
function homeDistances(o) {
  if (!o.homeDist) {
    const homes = [];
    for (let cell = 0; cell < o.size; cell++) if (o.territory[cell] === o.me) homes.push(cell);
    o.homeDist = new Int16Array(o.size);
    bfs(o, homes, o.homeDist, o.me, FAR, null);
  }
  return o.homeDist;
}

function neighbor(o, cell, d) {
  return o.adjacent[cell * 4 + d];
}

function directionTo(o, cell) {
  for (let d = 0; d < 4; d++) if (neighbor(o, o.head, d) === cell) return d;
  return -1;
}

/** A cell the head may enter this tick: in the zone next tick, not the own trail or a head. */
function enterable(o, cell, strict) {
  if (cell < 0 || o.expire[cell] <= 1 || o.trails[cell] === o.me) return false;
  return o.oppDist[cell] > (strict ? 1 : 0);
}

/**
 * Ticks until the plan closes on the own territory, or 0 when it is unsafe.
 * Every trail cell, old or new, must stay out of reach of every opponent and
 * inside the zone until then; no cell may be reachable by another head as soon
 * as the bot gets there.
 */
function planTime(o, plan) {
  const { territory, trails, me, expire, oppDist, danger } = o;
  let at = o.head;
  let outside = o.outside;
  let closes = 0;
  let reach = FAR;
  let life = FAR;
  for (const cell of o.myTrail) {
    if (danger[cell]) return 0;
    if (oppDist[cell] < reach) reach = oppDist[cell];
    if (expire[cell] < life) life = expire[cell];
  }
  for (let step = 1; step <= plan.length && !closes; step++) {
    const cell = plan[step - 1];
    if (typeof cell !== "number" || directionFrom(o, at, cell) < 0) return 0;
    if (trails[cell] === me || expire[cell] <= step || oppDist[cell] <= step) return 0;
    at = cell;
    if (territory[cell] === me) {
      if (outside) closes = step;
      continue;
    }
    outside = true;
    if (danger[cell]) return 0;
    if (oppDist[cell] < reach) reach = oppDist[cell];
    if (expire[cell] < life) life = expire[cell];
  }
  return closes > 0 && reach > closes && life > closes ? closes : 0;
}

function directionFrom(o, from, to) {
  for (let d = 0; d < 4; d++) if (neighbor(o, from, d) === to) return d;
  return -1;
}

/**
 * Step towards the nearest opponent trail cell the bot reaches no later than
 * that opponent can close, along a path whose trail no one can cut before the
 * bot is home again. Returns a direction, or -1.
 */
function findHunt(o) {
  const victims = o.opponents.filter((p) => p.trail.length > 0);
  if (!victims.length) return -1;
  const { size, territory, me, expire } = o;
  const scratch = new Int16Array(size);
  let reach = 0;
  for (const victim of victims) {
    // Fewest moves the victim needs to close: its trail blocks it.
    const reached = bfs(o, [victim.head], scratch, victim.slot, HUNT_RANGE, null);
    victim.close = FAR;
    for (let i = 0; i < reached; i++) {
      const cell = o.queue[i];
      if (territory[cell] === victim.slot) {
        victim.close = scratch[cell];
        break;
      }
    }
    reach = Math.max(reach, Math.min(victim.close, HUNT_RANGE));
  }
  const mine = new Int16Array(size);
  const parent = new Int32Array(size);
  bfs(o, [o.head], mine, me, reach, parent);
  let target = -1;
  let distance = FAR;
  let prey = null;
  for (const victim of victims) {
    for (const cell of victim.trail) {
      const d = mine[cell];
      if (d >= distance || d > victim.close || cell === victim.head || expire[cell] <= d) continue;
      target = cell;
      distance = d;
      prey = victim;
    }
  }
  if (target < 0) return -1;
  // The bot's trail lives until it is home; the victim's threat only until the cut.
  const back = territory[target] === me ? 0 : homeDistances(o)[target];
  const home = distance + back;
  if (back >= FAR) return -1;
  const preyDist = new Int16Array(size);
  bfs(o, [prey.head], preyDist, prey.slot, FAR, null);
  const others = o.opponents.filter((p) => p !== prey).map((p) => p.head);
  const otherDist = new Int16Array(size);
  bfs(o, others, otherDist, NO_SLOT, FAR, null);
  const exposed = o.myTrail.slice();
  let cell = target;
  for (let step = distance; ; step--) {
    if (preyDist[cell] <= step || otherDist[cell] <= step || expire[cell] <= step) return -1;
    if (territory[cell] !== me) exposed.push(cell);
    if (parent[cell] === o.head) break;
    cell = parent[cell];
  }
  for (const trail of exposed) {
    if (expire[trail] <= home || otherDist[trail] <= home || preyDist[trail] <= distance) return -1;
    if (trail !== target && o.danger[trail]) return -1;
  }
  return directionTo(o, cell);
}

/** Shortest way back to the own territory, preferring cells far from other heads. */
function goHome(o) {
  const homeDist = homeDistances(o);
  let best = -1;
  let bestScore = -FAR;
  for (let d = 0; d < 4; d++) {
    const cell = neighbor(o, o.head, d);
    if (!enterable(o, cell, false) || homeDist[cell] >= FAR) continue;
    const score = -homeDist[cell] * 4 + Math.min(o.oppDist[cell], 3);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best >= 0 ? best : survive(o);
}

/** No way home: keep the most room to move and hope the threat dies first. */
function survive(o) {
  let best = -1;
  let bestRoom = 0;
  const seen = new Uint8Array(o.size);
  for (let d = 0; d < 4; d++) {
    const start = neighbor(o, o.head, d);
    if (!enterable(o, start, false)) continue;
    seen.fill(0);
    let length = 0;
    o.queue[length++] = start;
    seen[start] = 1;
    for (let cursor = 0; cursor < length && length < 400; cursor++) {
      for (let e = 0; e < 4; e++) {
        const next = neighbor(o, o.queue[cursor], e);
        if (next < 0 || seen[next] || o.expire[next] === 0 || o.trails[next] === o.me) continue;
        seen[next] = 1;
        o.queue[length++] = next;
      }
    }
    const room = length * 4 + Math.min(o.oppDist[start], 3);
    if (room > bestRoom) {
      bestRoom = room;
      best = d;
    }
  }
  return best;
}

/** Inside the territory with nothing to do: stay put unless the cell is unsafe. */
function rest(o) {
  if (o.expire[o.head] > 2 && o.oppDist[o.head] > 1) return -1;
  let best = -1;
  let bestScore = -FAR;
  for (let d = 0; d < 4; d++) {
    const cell = neighbor(o, o.head, d);
    if (!enterable(o, cell, true)) continue;
    const score =
      Math.min(o.expire[cell], 40) +
      (o.territory[cell] === o.me ? 20 : 0) +
      Math.min(o.oppDist[cell], 5);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Best rectangular loop from a border cell of the own territory, as the list of
 * cells to visit: the walk to the anchor, then the loop until it closes.
 */
function planLoop(o) {
  const { width, size, territory, trails, me, expire, oppDist, queue } = o;
  // Prefix sums of the own territory, so the area a loop adds is counted in constant time.
  const stride = width + 1;
  const owned = new Int32Array(stride * stride);
  for (let y = 0; y < width; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      if (territory[y * width + x] === me) row++;
      owned[(y + 1) * stride + x + 1] = owned[y * stride + x + 1] + row;
    }
  }
  // Walk inside the territory, never onto a cell another head could reach as soon.
  const depth = new Int16Array(size).fill(FAR);
  const from = new Int32Array(size);
  const anchors = [[], [], [], []];
  let length = 0;
  depth[o.head] = 0;
  queue[length++] = o.head;
  for (let cursor = 0; cursor < length; cursor++) {
    const cell = queue[cursor];
    const step = depth[cell] + 1;
    for (let d = 0; d < 4; d++) {
      const next = neighbor(o, cell, d);
      if (next < 0) continue;
      if (territory[next] !== me) {
        if (
          anchors[d].length < ANCHORS_PER_DIRECTION &&
          depth[cell] <= MAX_WALK &&
          trails[next] !== me
        )
          anchors[d].push(cell);
        continue;
      }
      if (depth[next] < FAR || oppDist[next] <= step || expire[next] <= step) continue;
      depth[next] = step;
      from[next] = cell;
      queue[length++] = next;
    }
  }
  let best = null;
  for (let d1 = 0; d1 < 4; d1++) {
    for (const anchor of anchors[d1]) {
      for (const d2 of [(d1 + 1) % 4, (d1 + 3) % 4]) {
        // A loop that ends on its first leg ends the same way for every longer l1,
        // and one that ends on its second leg the same way for every longer l2.
        let firstLeg = false;
        for (let i = 0; i < SIZES.length && !firstLeg; i++) {
          for (let j = 0; j < SIZES.length; j++) {
            const l1 = SIZES[i];
            const l2 = SIZES[j];
            const loop = scoreLoop(o, owned, anchor, depth[anchor], d1, d2, l1, l2);
            if (loop.score !== null && (!best || loop.score > best.score))
              best = { ...loop, anchor, d1, d2, l1, l2 };
            firstLeg = loop.leg === 0;
            if (loop.leg < 2) break;
          }
        }
      }
    }
  }
  if (!best) return null;
  const path = [];
  for (let cell = best.anchor; cell !== o.head; cell = from[cell]) path.push(cell);
  path.reverse();
  const legs = [
    [best.d1, best.l1],
    [best.d2, best.l2],
    [(best.d1 + 2) % 4, best.l1],
    [(best.d2 + 2) % 4, best.l2],
  ];
  let at = best.anchor;
  let steps = 0;
  for (const [d, count] of legs) {
    for (let i = 0; i < count && steps < best.closes; i++, steps++) {
      at = neighbor(o, at, d);
      path.push(at);
    }
  }
  return planTime(o, path) > 0 ? path : null;
}

/**
 * Score of one loop, null when it leaves the zone, never closes or can be cut,
 * with the leg (0..3) on which it closed or failed.
 */
function scoreLoop(o, owned, anchor, walk, d1, d2, l1, l2) {
  const { width, territory, trails, me, expire, oppDist, danger } = o;
  const stride = width + 1;
  let x = anchor % width;
  let y = (anchor / width) | 0;
  let minX = x;
  let maxX = x;
  let minY = y;
  let maxY = y;
  let step = walk;
  let reach = FAR;
  let life = FAR;
  for (let leg = 0; leg < 4; leg++) {
    const d = leg === 0 ? d1 : leg === 1 ? d2 : leg === 2 ? (d1 + 2) % 4 : (d2 + 2) % 4;
    const count = leg % 2 === 0 ? l1 : l2;
    for (let i = 0; i < count; i++) {
      x += DX[d];
      y += DY[d];
      step++;
      if (x < 0 || y < 0 || x >= width || y >= width) return { score: null, leg };
      const cell = y * width + x;
      if (trails[cell] === me || expire[cell] <= step || oppDist[cell] <= step)
        return { score: null, leg };
      if (territory[cell] === me) {
        if (reach <= step || life <= step) return { score: null, leg };
        const gain =
          (maxX - minX + 1) * (maxY - minY + 1) -
          (owned[(maxY + 1) * stride + maxX + 1] -
            owned[minY * stride + maxX + 1] -
            owned[(maxY + 1) * stride + minX] +
            owned[minY * stride + minX]);
        if (gain <= 0) return { score: null, leg };
        const slack = reach - step;
        const risk = slack < RISK_SLACK ? (RISK_SLACK - slack) * RISK_STEP : 0;
        return { score: gain / (1 + step / TIME_WEIGHT) - risk, closes: step - walk, leg };
      }
      if (danger[cell]) return { score: null, leg };
      if (oppDist[cell] < reach) reach = oppDist[cell];
      if (expire[cell] < life) life = expire[cell];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { score: null, leg: 3 };
}
