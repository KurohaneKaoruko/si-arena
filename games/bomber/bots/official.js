/**
 * Official example bot for 炸弹人 (bomber).
 *
 * Being hit by any flame is the end, so the bot predicts fire first and plans
 * around it:
 *
 * - Every tick it computes, from every bomb on the map, at which of the next
 *   8 settlements each cell burns: a bomb with fuse f explodes at settlement
 *   f - 1 from now, its flames reach `range` cells per direction (soft walls,
 *   pillars and collapsed cells block them), and a bomb inside a flame goes
 *   off at the same time, repeated until nothing changes. Soft walls are
 *   treated as standing for the whole horizon, which only hides fire the bot
 *   would otherwise avoid too.
 * - Collapsing rings are deadly from the settlement that removes them: ring
 *   `nextRing` at `ticksToNextCollapse - 1`, each further ring 8 ticks later.
 * - A breadth-first search over (cell, time) finds every position the bot can
 *   reach within the horizon without standing in fire or on a collapsing
 *   cell, never entering a bomb cell before that bomb is gone. A position
 *   counts as alive only when it can still reach the end of the horizon, so
 *   the first move always keeps an escape.
 * - It places a bomb when its flames from here would reach a soft wall that
 *   no other bomb already covers, or an opponent, and the same search still
 *   finds an escape after adding that bomb (fuse 8) to the prediction.
 * - Otherwise it walks, along alive moves, down a distance field towards the
 *   nearest powerup, else the nearest cell from which a bomb hits a wall or an
 *   opponent, else the centre; cells that collapse before it could get there
 *   are never targets, and ties prefer cells no bomb threatens at all.
 * - With no alive move it takes the move that stays safe the longest.
 *
 * The bot uses the same observation, SDK, Memory and limits as every player.
 * Every search is bounded by the 195 cells and the 8-tick horizon.
 */

const DIRECTIONS = ["up", "right", "down", "left"];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const HORIZON = 8;
const FAR = 30000;
const FUSE = 8;
const STAY = -1;
const BOMB = 4;

export default function tick({ game }) {
  const o = survey(game);
  const action = decide(o);
  if (action === BOMB) game.self.bomb();
  else if (action === STAY) game.self.idle();
  else game.self.move(DIRECTIONS[action]);
}

/** Everything a decision needs, measured once from the current observation. */
function survey(game) {
  const width = game.board.width;
  const height = game.board.height;
  const size = width * height;
  const cells = game.board.cells;
  const self = game.self;
  const head = self.position.y * width + self.position.x;
  const bombs = game.bombs.map((bomb) => ({
    cell: bomb.position.y * width + bomb.position.x,
    time: bomb.fuse - 1,
    range: bomb.range,
    flames: null,
  }));
  const bombAt = new Int16Array(size).fill(-1);
  bombs.forEach((bomb, index) => {
    bombAt[bomb.cell] = index;
  });
  const collapseAt = new Int32Array(size).fill(FAR);
  const collapse = game.collapse;
  const ring = new Int8Array(size);
  for (let y = 0, cell = 0; y < height; y++) {
    for (let x = 0; x < width; x++, cell++) {
      const r = Math.min(x, width - 1 - x, y, height - 1 - y);
      ring[cell] = r;
      if (collapse.nextRing !== null && r >= collapse.nextRing)
        collapseAt[cell] =
          collapse.ticksToNextCollapse - 1 + collapse.interval * (r - collapse.nextRing);
    }
  }
  const occupied = new Uint8Array(size);
  for (const p of game.opponents) occupied[p.position.y * width + p.position.x] = 1;
  const items = new Uint8Array(size);
  for (const item of game.powerups) items[item.position.y * width + item.position.x] = 1;
  const o = {
    width,
    height,
    size,
    cells,
    head,
    me: self.slot,
    range: self.fireRange,
    canBomb: self.activeBombs < self.bombsMax && bombAt[head] < 0,
    bombs,
    bombAt,
    bombTime: null,
    fire: null,
    collapseAt,
    ring,
    occupied,
    items,
    hasItems: game.powerups.length > 0,
  };
  predict(o, bombs);
  return o;
}

/** Cells a bomb at `cell` with `range` covers, through other bombs, stopping on a soft wall. */
function rays(o, cell, range) {
  const { width, height, cells } = o;
  const covered = [cell];
  const x0 = cell % width;
  const y0 = (cell / width) | 0;
  for (let d = 0; d < 4; d++) {
    for (let step = 1; step <= range; step++) {
      const x = x0 + DX[d] * step;
      const y = y0 + DY[d] * step;
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      const next = y * width + x;
      const value = cells[next];
      if (value === 1 || value === 3) break;
      covered.push(next);
      if (value === 2) break;
    }
  }
  return covered;
}

/**
 * Fill o.fire (bit t set when the cell burns at settlement t, t < HORIZON) and
 * o.bombTime (settlement at which each cell's bomb explodes, -1 without one)
 * from the given bombs, including chain reactions.
 */
function predict(o, bombs) {
  const times = bombs.map((bomb) => bomb.time);
  for (const bomb of bombs) if (!bomb.flames) bomb.flames = rays(o, bomb.cell, bomb.range);
  const at = new Int16Array(o.size).fill(-1);
  bombs.forEach((bomb, index) => {
    at[bomb.cell] = index;
  });
  for (let changed = true; changed;) {
    changed = false;
    for (let index = 0; index < bombs.length; index++) {
      for (const cell of bombs[index].flames) {
        const other = at[cell];
        if (other >= 0 && times[other] > times[index]) {
          times[other] = times[index];
          changed = true;
        }
      }
    }
  }
  const fire = new Uint8Array(o.size);
  const bombTime = new Int32Array(o.size).fill(-1);
  bombs.forEach((bomb, index) => {
    bombTime[bomb.cell] = times[index];
    if (times[index] >= HORIZON) return;
    for (const cell of bomb.flames) fire[cell] |= 1 << times[index];
  });
  o.fire = fire;
  o.bombTime = bombTime;
}

/** Whether standing on `cell` after the settlement at offset `t` is fatal. */
function deadly(o, cell, t) {
  return (t < HORIZON && ((o.fire[cell] >> t) & 1) === 1) || o.collapseAt[cell] <= t;
}

/** Whether a move made at offset `t` may enter `cell`: empty and no bomb still there. */
function enterable(o, cell, t) {
  return o.cells[cell] === 0 && o.bombTime[cell] < t;
}

function neighbour(o, cell, d) {
  const x = (cell % o.width) + DX[d];
  const y = ((cell / o.width) | 0) + DY[d];
  return x < 0 || y < 0 || x >= o.width || y >= o.height ? -1 : y * o.width + x;
}

/**
 * Positions reachable alive within the horizon. Row k holds the positions
 * after the move at offset k - 1; a position is alive when it survives that
 * settlement and can still go on to the end of the horizon. With `hold`, the
 * first move is a stay (the bot places a bomb instead of moving).
 */
function survivable(o, hold) {
  const rows = [];
  const first = new Uint8Array(o.size);
  first[o.head] = 1;
  rows.push(first);
  for (let k = 1; k <= HORIZON; k++) {
    const previous = rows[k - 1];
    const row = new Uint8Array(o.size);
    for (let cell = 0; cell < o.size; cell++) {
      if (!previous[cell]) continue;
      if (!deadly(o, cell, k - 1)) row[cell] = 1;
      if (k === 1 && hold) continue;
      for (let d = 0; d < 4; d++) {
        const next = neighbour(o, cell, d);
        if (next >= 0 && enterable(o, next, k - 1) && !deadly(o, next, k - 1)) row[next] = 1;
      }
    }
    rows.push(row);
  }
  // Backward pass: keep only positions from which the horizon stays reachable.
  for (let k = HORIZON - 1; k >= 0; k--) {
    const row = rows[k];
    const later = rows[k + 1];
    for (let cell = 0; cell < o.size; cell++) {
      if (!row[cell]) continue;
      let alive = later[cell] === 1;
      if (!(k === 0 && hold))
        for (let d = 0; d < 4 && !alive; d++) {
          const next = neighbour(o, cell, d);
          alive = next >= 0 && enterable(o, next, k) && later[next] === 1;
        }
      if (!alive) row[cell] = 0;
    }
  }
  return rows;
}

/** Whether a bomb placed here now would do something: reach an uncovered wall or an opponent. */
function worthBombing(o) {
  for (const cell of rays(o, o.head, o.range)) {
    if (cell === o.head) continue;
    if (o.cells[cell] === 2 && o.fire[cell] === 0) return true;
    if (o.occupied[cell]) return true;
  }
  return false;
}

/** Breadth-first distances over empty cells from several sources, bombs ignored. */
function distances(o, sources) {
  const dist = new Int32Array(o.size).fill(FAR);
  const queue = new Int32Array(o.size);
  let length = 0;
  for (const source of sources) {
    if (dist[source] !== FAR) continue;
    dist[source] = 0;
    queue[length++] = source;
  }
  for (let cursor = 0; cursor < length; cursor++) {
    const cell = queue[cursor];
    for (let d = 0; d < 4; d++) {
      const next = neighbour(o, cell, d);
      if (next < 0 || o.cells[next] !== 0 || dist[next] !== FAR) continue;
      dist[next] = dist[cell] + 1;
      queue[length++] = next;
    }
  }
  return dist;
}

/** Cells to walk towards, by priority: nearby powerups, bombing spots, the centre. */
function targets(o, fromHead, excluded) {
  const soon = (cell) => o.collapseAt[cell] <= fromHead[cell] + 2;
  if (o.hasItems) {
    const picks = [];
    for (let cell = 0; cell < o.size; cell++)
      if (o.items[cell] && fromHead[cell] < 12 && !soon(cell)) picks.push(cell);
    if (picks.length) return picks;
  }
  const spots = [];
  for (let cell = 0; cell < o.size; cell++) {
    if (o.cells[cell] !== 0 || cell === excluded || fromHead[cell] === FAR || soon(cell)) continue;
    let useful = false;
    for (const hit of rays(o, cell, o.range)) {
      if (hit === cell) continue;
      if ((o.cells[hit] === 2 && o.fire[hit] === 0) || o.occupied[hit]) useful = true;
    }
    if (useful) spots.push(cell);
  }
  if (spots.length) return spots;
  const centre = [];
  let best = -1;
  for (let cell = 0; cell < o.size; cell++) {
    if (o.cells[cell] !== 0 || fromHead[cell] === FAR) continue;
    if (o.ring[cell] > best) {
      best = o.ring[cell];
      centre.length = 0;
    }
    if (o.ring[cell] === best) centre.push(cell);
  }
  return centre;
}

function decide(o) {
  const rows = survivable(o, false);
  let excluded = -1;
  if (o.canBomb && worthBombing(o)) {
    const planned = o.bombs.concat([
      { cell: o.head, time: FUSE - 1, range: o.range, flames: null },
    ]);
    const saved = { fire: o.fire, bombTime: o.bombTime };
    predict(o, planned);
    const escape = survivable(o, true)[0][o.head] === 1;
    o.fire = saved.fire;
    o.bombTime = saved.bombTime;
    if (escape) return BOMB;
    // Standing on a useful spot without an escape: look for another one.
    excluded = o.head;
  }
  const fromHead = distances(o, [o.head]);
  const goals = targets(o, fromHead, excluded);
  const toGoal = distances(o, goals);
  let best = STAY;
  let bestScore = -FAR;
  const options = [[STAY, o.head]];
  for (let d = 0; d < 4; d++) {
    const next = neighbour(o, o.head, d);
    if (next >= 0) options.push([d, next]);
  }
  for (const [d, cell] of options) {
    if (!rows[1][cell]) continue;
    if (d !== STAY && !enterable(o, cell, 0)) continue;
    const distance = toGoal[cell] === FAR ? 100 : toGoal[cell];
    const score =
      -distance * 10 +
      (o.fire[cell] === 0 ? 4 : 0) +
      Math.min(o.collapseAt[cell], 20) / 10 +
      (d === STAY ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  if (bestScore > -FAR) return best;
  // Nothing survives the horizon: delay the end as long as possible.
  let latest = -1;
  for (const [d, cell] of options) {
    if (d !== STAY && !enterable(o, cell, 0)) continue;
    let t = 0;
    while (t < HORIZON && !deadly(o, cell, t)) t++;
    if (t > latest) {
      latest = t;
      best = d;
    }
  }
  return best;
}
