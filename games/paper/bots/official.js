/**
 * Official example bot for the paper game.
 *
 * The bot carves the map with rectangular sweeps. A player that leaves its
 * territory leaves a trail, and the trail together with the territory forms a
 * barrier: when the head returns to its own territory everything the barrier
 * encloses becomes its territory. So a sweep is a rectangle of free space
 * anchored on the own border:
 *
 *   out along d1, across along d2, back along -d1, home along -d2.
 *
 * A sweep is only started when the opponent cannot reach any cell of the
 * trail before the sweep closes; otherwise the bot abandons it and runs home.
 * Stepping on an opponent trail resets the opponent to its spawn and ends the
 * current excursion of that opponent, which is a good trade, but it never ends
 * the match: both players keep their territory and the match always runs to
 * the tick limit.
 *
 * The bot uses the same observation, SDK, Memory and limits as every player.
 */

const DIRECTIONS = ["up", "right", "down", "left"];
const DELTAS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
/** Side lengths a sweep may use; the planner scores every combination. */
const SWEEP_SIZES = [1, 2, 3, 4, 6, 8, 10, 13, 16, 20];
/** Longest walk inside the own territory before a sweep is started. */
const MAX_WALK = 24;
/** Extra ticks the opponent needs to reach the trail of a planned sweep. */
const SAFETY_MARGIN = 0;
/**
 * Clearance the opponent must keep from a planned trail before departure.
 * Every sweep the planner accepts keeps at least this distance at plan time
 * (its trail needs more steps than the opponent needs to reach it, and no
 * sweep is shorter than three steps), so the departure check below only
 * rejects stored plans whose opponent has closed in since they were made.
 */
const DEPARTURE_CLEARANCE = 3;
/** Divisor that turns a sweep into a score per tick spent. */
const TIME_WEIGHT = 24;
/** Distance at which an opponent close to the sweep costs score. */
const RISK_NEAR = 8;
const RISK_STEP = 6;

function cellOf(o, x, y) {
  return y * o.width + x;
}
function xOf(o, cell) {
  return cell % o.width;
}
function yOf(o, cell) {
  return (cell / o.width) | 0;
}
function stepFrom(o, cell, dir) {
  const x = xOf(o, cell) + DELTAS[dir][0];
  const y = yOf(o, cell) + DELTAS[dir][1];
  if (x < 0 || y < 0 || x >= o.width || y >= o.height) return -1;
  return cellOf(o, x, y);
}
function isMine(o, cell) {
  return o.territory[cell] === o.selfSlot;
}
function maxSteps(o, cell, dir) {
  const dx = DELTAS[dir][0];
  const dy = DELTAS[dir][1];
  const x = xOf(o, cell);
  const y = yOf(o, cell);
  if (dx > 0) return o.width - 1 - x;
  if (dx < 0) return x;
  if (dy > 0) return o.height - 1 - y;
  return y;
}
/** Prefix sum of the own territory, so any rectangle is counted in constant time. */
function minePrefix(o) {
  const stride = o.width + 1;
  const sum = new Int32Array(stride * (o.height + 1));
  for (let y = 0; y < o.height; y++) {
    let row = 0;
    for (let x = 0; x < o.width; x++) {
      if (o.territory[y * o.width + x] === o.selfSlot) row++;
      sum[(y + 1) * stride + (x + 1)] = sum[y * stride + (x + 1)] + row;
    }
  }
  return sum;
}
/** Own territory as bytes, so a leg is scanned without touching the prefix sum. */
function ownedMap(o) {
  const owned = new Uint8Array(o.width * o.height);
  for (let index = 0; index < owned.length; index++) {
    if (o.territory[index] === o.selfSlot) owned[index] = 1;
  }
  return owned;
}
/**
 * Closest border cell per direction, the walk to it and the walk length.
 * A border cell is a cell of the own territory with a free neighbour; the
 * sweep starts there so that the first leg leaves the territory at once.
 * The opponent head is never entered, so the walk cannot step into it.
 */
function findAnchors(o, head, enemyCell) {
  const size = o.width * o.height;
  const seen = new Uint8Array(size);
  const parent = new Int32Array(size);
  const pdir = new Int8Array(size);
  const depth = new Int32Array(size);
  const queue = [head];
  seen[head] = 1;
  const anchors = [null, null, null, null];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor];
    for (let dir = 0; dir < 4; dir++) {
      const next = stepFrom(o, cell, dir);
      if (next < 0) continue;
      // Moving onto the opponent head is a head collision, so the walk
      // treats that cell as blocked and never routes through it.
      if (next === enemyCell) continue;
      if (isMine(o, next)) {
        if (seen[next]) continue;
        seen[next] = 1;
        parent[next] = cell;
        pdir[next] = dir;
        depth[next] = depth[cell] + 1;
        queue.push(next);
        continue;
      }
      if (!anchors[dir] && depth[cell] <= MAX_WALK) anchors[dir] = cell;
    }
  }
  return { anchors, parent, pdir, depth };
}
function pathTo(parent, pdir, head, cell) {
  const path = [];
  let current = cell;
  while (current !== head) {
    path.push(pdir[current]);
    current = parent[current];
  }
  path.reverse();
  return path;
}
/**
 * Best sweep for the current position, or null when no sweep is safe.
 *
 * A sweep is scored by the area it encloses against the ticks it costs. The
 * trail only exists while the head is outside the territory, so a sweep is
 * safe when the opponent stays further away from the whole trail than the
 * number of ticks the sweep needs to close.
 */
function planSweep(o, margin) {
  const self = o.players[o.selfSlot];
  const head = cellOf(o, self.position.x, self.position.y);
  const prefix = minePrefix(o);
  const owned = ownedMap(o);
  const opponent = o.players[1 - o.selfSlot];
  const enemy = opponent.position ? opponent.position : null;
  const ex = enemy ? enemy.x : -1;
  const ey = enemy ? enemy.y : -1;
  const enemyCell = enemy ? cellOf(o, ex, ey) : -1;
  const { anchors, parent, pdir, depth } = findAnchors(o, head, enemyCell);
  const stride = o.width + 1;
  let best = null;
  for (let d1 = 0; d1 < 4; d1++) {
    const anchor = anchors[d1];
    if (anchor === null) continue;
    const ax = xOf(o, anchor);
    const ay = yOf(o, anchor);
    const walk = depth[anchor];
    const limit1 = maxSteps(o, anchor, d1);
    for (const d2 of [(d1 + 1) % 4, (d1 + 3) % 4]) {
      const limit2 = maxSteps(o, anchor, d2);
      const e1x = DELTAS[d1][0];
      const e1y = DELTAS[d1][1];
      const e2x = DELTAS[d2][0];
      const e2y = DELTAS[d2][1];
      for (const l1 of SWEEP_SIZES) {
        if (l1 > limit1) continue;
        for (const l2 of SWEEP_SIZES) {
          if (l2 > limit2) continue;
          // Walk the four legs of the rectangle: out along d1, across along d2,
          // back along -d1 and home along -d2. The head returns to its own
          // territory on the first owned cell, so the walk ends there and the
          // enclosed area is what the trail and the territory surround.
          let px = ax;
          let py = ay;
          let length = 0;
          let minX = ax;
          let maxX = ax;
          let minY = ay;
          let maxY = ay;
          let closest = Infinity;
          let closed = false;
          for (let leg = 0; leg < 4 && !closed; leg++) {
            let dx;
            let dy;
            let count;
            if (leg === 0) {
              dx = e1x;
              dy = e1y;
              count = l1;
            } else if (leg === 1) {
              dx = e2x;
              dy = e2y;
              count = l2;
            } else if (leg === 2) {
              dx = -e1x;
              dy = -e1y;
              count = l1;
            } else {
              dx = -e2x;
              dy = -e2y;
              count = l2;
            }
            const sx = px + dx;
            const sy = py + dy;
            let low = 0;
            let high = count;
            while (low < high) {
              const mid = (low + high) >> 1;
              if (owned[(sy + dy * mid) * o.width + (sx + dx * mid)]) high = mid;
              else low = mid + 1;
            }
            const visited = low < count ? low + 1 : count;
            const tx = sx + dx * (visited - 1);
            const ty = sy + dy * (visited - 1);
            px = tx;
            py = ty;
            if (sx < minX) minX = sx;
            if (sx > maxX) maxX = sx;
            if (sy < minY) minY = sy;
            if (sy > maxY) maxY = sy;
            if (tx < minX) minX = tx;
            if (tx > maxX) maxX = tx;
            if (ty < minY) minY = ty;
            if (ty > maxY) maxY = ty;
            length += visited;
            if (enemy) {
              // Manhattan distance from the opponent head to this leg.
              let distance;
              if (sy === ty) {
                const lo = sx < tx ? sx : tx;
                const hi = sx < tx ? tx : sx;
                const off = ex < lo ? lo - ex : ex > hi ? ex - hi : 0;
                distance = (ey > sy ? ey - sy : sy - ey) + off;
              } else {
                const lo = sy < ty ? sy : ty;
                const hi = sy < ty ? ty : sy;
                const off = ey < lo ? lo - ey : ey > hi ? ey - hi : 0;
                distance = (ex > sx ? ex - sx : sx - ex) + off;
              }
              if (distance < closest) closest = distance;
            }
            if (low < count) closed = true;
          }
          if (length < 3) continue;
          if (enemy && closest <= length + margin) continue;
          const area = (maxX - minX + 1) * (maxY - minY + 1);
          const gain =
            area -
            (prefix[(maxY + 1) * stride + (maxX + 1)] -
              prefix[minY * stride + (maxX + 1)] -
              prefix[(maxY + 1) * stride + minX] +
              prefix[minY * stride + minX]);
          if (gain <= 0) continue;
          const cost = walk + length;
          const risk = enemy && closest <= RISK_NEAR ? (RISK_NEAR - closest) * RISK_STEP : 0;
          const score = gain / (1 + cost / TIME_WEIGHT) - risk;
          if (!best || score > best.score) {
            best = { score, anchor, d1, d2, l1, l2, length };
          }
        }
      }
    }
  }
  if (!best) return null;
  const sweep = [];
  const shape = [
    [best.d1, best.l1],
    [best.d2, best.l2],
    [(best.d1 + 2) % 4, best.l1],
    [(best.d2 + 2) % 4, best.l2],
  ];
  for (const [dir, count] of shape) {
    for (let step = 0; step < count && sweep.length < best.length; step++) sweep.push(dir);
  }
  return { walk: pathTo(parent, pdir, head, best.anchor), sweep };
}

/**
 * Whether the remaining sweep still closes on the own territory without the
 * opponent already standing next to the planned trail. The walk starts at
 * the current head, so a stored plan is re-checked against the layout it
 * actually meets: a sweep planned before a walk through the territory, or
 * left over after an early closure, never starts straight into the
 * opponent. Once the head is outside, the per-tick threat check owns the
 * decision to continue the sweep or run home.
 */
function sweepStillSafe(o, sweep) {
  const opponent = o.players[1 - o.selfSlot];
  if (!opponent.position) return true;
  const ex = opponent.position.x;
  const ey = opponent.position.y;
  let x = o.players[o.selfSlot].position.x;
  let y = o.players[o.selfSlot].position.y;
  let closest = Infinity;
  for (const dir of sweep) {
    x += DELTAS[dir][0];
    y += DELTAS[dir][1];
    if (x < 0 || y < 0 || x >= o.width || y >= o.height) return false;
    const distance = Math.abs(x - ex) + Math.abs(y - ey);
    if (distance < closest) closest = distance;
    if (isMine(o, y * o.width + x)) return closest > DEPARTURE_CLEARANCE;
  }
  // The stored sweep no longer reaches the own territory; the planner only
  // starts sweeps that close, so this one is stale.
  return false;
}

export default function tick({ game, Memory }) {
  const players = [];
  players[game.self.slot] = game.self;
  players[game.opponent.slot] = game.opponent;
  const o = {
    ...game.board,
    tick: game.tick,
    maxTicks: game.maxTicks,
    selfSlot: game.self.slot,
    players,
  };
  if (game.events.some((e) => e.type === "reset" && e.playerId === game.self.id))
    Memory.plan = null;
  const action = decide(o, Memory);
  if (action.type === "move") game.self.move(action.direction);
  else game.self.idle();
}

function decide(o, Memory) {
  const self = o.players[o.selfSlot];
  if (!self.position) return { type: "idle" };
  // A reset sends the head back to the spawn, so a plan that was built for the
  // previous position no longer applies.
  const home = homePath(o);
  const threat = threatDistance(o);
  const safe = safeMoves(o);
  const plan = Memory.plan ?? null;

  // Outside the territory and without a way home: only a cut can help.
  if (home === null) {
    Memory.plan = null;
    return cutOpponent(o, safe) ?? { type: "idle" };
  }

  if (home.length > 0) {
    // The trail exists, so the opponent may cut it. A sweep only survives
    // while the opponent stays further away than the remaining ticks.
    const sweep = plan && plan.mode === "sweep" ? plan.sweep : [];
    if (sweep.length > 0 && (threat === null || threat > sweep.length)) {
      const next = DIRECTIONS[sweep[0]];
      if (safe.includes(next)) {
        const rest = sweep.slice(1);
        Memory.plan = { mode: rest.length ? "sweep" : "idle", walk: [], sweep: rest };
        return { type: "move", direction: next };
      }
    }
    Memory.plan = { mode: "idle", walk: [], sweep: [] };
    const step = home[0];
    if (safe.includes(step)) return { type: "move", direction: step };
    return cutOpponent(o, safe) ?? { type: "idle" };
  }

  // Inside the own territory: cut an exposed opponent trail if there is one.
  const cut = cutOpponent(o, safe);
  if (cut) {
    Memory.plan = { mode: "idle", walk: [], sweep: [] };
    return cut;
  }
  if (plan && plan.mode === "sweep" && plan.sweep.length > 0 && sweepStillSafe(o, plan.sweep)) {
    const next = DIRECTIONS[plan.sweep[0]];
    if (safe.includes(next)) {
      const rest = plan.sweep.slice(1);
      Memory.plan = { mode: rest.length ? "sweep" : "idle", walk: [], sweep: rest };
      return { type: "move", direction: next };
    }
  } else if (plan && plan.mode === "walk" && plan.walk.length > 0) {
    const next = DIRECTIONS[plan.walk[0]];
    if (safe.includes(next)) {
      const rest = plan.walk.slice(1);
      Memory.plan = { mode: rest.length ? "walk" : "sweep", walk: rest, sweep: plan.sweep };
      return { type: "move", direction: next };
    }
  }
  const next = planSweep(o, SAFETY_MARGIN);
  if (!next) {
    Memory.plan = { mode: "idle", walk: [], sweep: [] };
    return { type: "idle" };
  }
  // Every emitted move is checked against the safe directions before it
  // leaves the bot. An unsafe first step waits one tick and keeps the plan,
  // because every later step is checked again before it is used.
  if (next.walk.length > 0) {
    const first = DIRECTIONS[next.walk[0]];
    if (!safe.includes(first)) {
      Memory.plan = { mode: "walk", walk: next.walk, sweep: next.sweep };
      return { type: "idle" };
    }
    Memory.plan = { mode: "walk", walk: next.walk.slice(1), sweep: next.sweep };
    return { type: "move", direction: first };
  }
  const first = DIRECTIONS[next.sweep[0]];
  if (!safe.includes(first)) {
    Memory.plan = { mode: "sweep", walk: [], sweep: next.sweep };
    return { type: "idle" };
  }
  Memory.plan = { mode: "sweep", walk: [], sweep: next.sweep.slice(1) };
  return { type: "move", direction: first };
}

/** Step on an opponent trail next to the head; that resets the opponent to its spawn. */
function cutOpponent(o, safe) {
  const self = o.players[o.selfSlot];
  const head = cellOf(o, self.position.x, self.position.y);
  const enemySlot = 1 - o.selfSlot;
  const opponent = o.players[1 - o.selfSlot];
  for (let dir = 0; dir < 4; dir++) {
    const next = stepFrom(o, head, dir);
    if (next < 0) continue;
    if (o.trails[next] !== enemySlot) continue;
    if (!safe.includes(DIRECTIONS[dir])) continue;
    // The opponent head may move onto the same cell, which would reset both
    // players instead of only the opponent.
    if (opponent.position) {
      const distance =
        Math.abs(xOf(o, next) - opponent.position.x) + Math.abs(yOf(o, next) - opponent.position.y);
      if (distance <= 1) continue;
    }
    return { type: "move", direction: DIRECTIONS[dir] };
  }
  return null;
}

// Player-owned algorithms; not part of the public game API.

function ownPlayer(o) {
  return o.players[o.selfSlot];
}
function homePath(o) {
  const p = ownPlayer(o);
  if (!p.position) return null;
  const start = cellOf(o, p.position.x, p.position.y);
  if (o.territory[start] === o.selfSlot) return [];
  const seen = new Uint8Array(o.width * o.height),
    parent = new Int32Array(seen.length),
    move = new Int8Array(seen.length);
  const queue = [start];
  seen[start] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor];
    for (let d = 0; d < 4; d++) {
      const target = stepFrom(o, cell, d);
      if (target < 0 || seen[target] || o.trails[target] === o.selfSlot) continue;
      seen[target] = 1;
      parent[target] = cell;
      move[target] = d;
      if (o.territory[target] === o.selfSlot) {
        const path = [];
        let current = target;
        while (current !== start) {
          path.push(DIRECTIONS[move[current]]);
          current = parent[current];
        }
        return path.toReversed();
      }
      queue.push(target);
    }
  }
  return null;
}
function threatDistance(o) {
  const enemy = o.players[1 - o.selfSlot];
  if (!enemy.position) return null;
  const start = cellOf(o, enemy.position.x, enemy.position.y),
    distance = new Int32Array(o.width * o.height);
  distance.fill(-1);
  const queue = [start];
  distance[start] = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor];
    if (o.trails[cell] === o.selfSlot) return distance[cell];
    for (let d = 0; d < 4; d++) {
      const target = stepFrom(o, cell, d);
      if (target < 0 || distance[target] >= 0 || o.trails[target] === enemy.slot) continue;
      distance[target] = distance[cell] + 1;
      queue.push(target);
    }
  }
  return null;
}
function safeMoves(o) {
  const p = ownPlayer(o);
  if (!p.position) return [];
  const start = cellOf(o, p.position.x, p.position.y),
    enemy = o.players[1 - o.selfSlot];
  const result = [];
  for (let d = 0; d < 4; d++) {
    const target = stepFrom(o, start, d);
    if (target < 0 || o.trails[target] === o.selfSlot) continue;
    if (enemy.position && target === cellOf(o, enemy.position.x, enemy.position.y)) continue;
    result.push(DIRECTIONS[d]);
  }
  return result;
}
