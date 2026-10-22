import { isJsonSnapshot, snapshotJson, type DeepReadonly } from "@si-arena/protocol";
import { ROYALE_CONFIG, ROYALE_MAX_TICKS, royaleMapSize, royaleZoneTarget } from "../constants";
import type {
  RoyaleEliminated,
  RoyaleEvent,
  RoyaleObservation,
  RoyaleState,
  RoyaleVisiblePlayer,
  RoyaleZone,
} from "../sdk";
import {
  insideZone,
  readCauses,
  readGrid,
  readPosition,
  royaleAreas,
  viewRoyaleState,
  zoneMin,
} from "./state";
import { readArray, readId, readInteger, readRecord } from "./validation";

/** A game is over once at most one player is alive or the tick limit is reached. */
export function royaleFinished(state: DeepReadonly<RoyaleState>): boolean {
  return (
    state.tick >= state.maxTicks || state.players.filter((player) => !player.death).length <= 1
  );
}

/** The zone as players see it; the next shrink is due on the next multiple of the interval. */
export function royaleZone(tick: number, width: number, size: number, alive: number): RoyaleZone {
  const target = royaleZoneTarget(alive);
  const min = zoneMin(width, size);
  const interval = ROYALE_CONFIG.shrinkInterval;
  return {
    size,
    target,
    min: { x: min, y: min },
    ticksToNextShrink: size > target ? interval - (tick % interval) : null,
  };
}

/** Each tick yields at most a move, cut, capture and death per player plus one shrink. */
const maxEvents = (players: number) => players * 4 + 1;

function readEvents(raw: unknown, ids: readonly string[], side: number): RoyaleEvent[] {
  if (!Array.isArray(raw) || raw.length > maxEvents(ids.length))
    throw new TypeError("Invalid Royale events");
  const playerId = (rawId: unknown) => {
    const id = readId(rawId);
    if (!ids.includes(id)) throw new TypeError("Unknown event player");
    return id;
  };
  const position = (rawPoint: unknown) => readPosition(rawPoint, side, "event position");
  return readArray(raw, raw.length, "events").map((item): RoyaleEvent => {
    if (item === null || typeof item !== "object") throw new TypeError("Invalid event");
    const type = Object.getOwnPropertyDescriptor(item, "type")?.value;
    if (type === "move") {
      const event = readRecord(item, ["type", "playerId", "from", "to"], "move event");
      return {
        type,
        playerId: playerId(event.playerId),
        from: position(event.from),
        to: position(event.to),
      };
    }
    if (type === "trail-cut") {
      const event = readRecord(item, ["type", "playerId", "attackerId", "position"], "cut event");
      return {
        type,
        playerId: playerId(event.playerId),
        attackerId: playerId(event.attackerId),
        position: position(event.position),
      };
    }
    if (type === "capture") {
      const event = readRecord(item, ["type", "playerId", "cells"], "capture event");
      if (!Array.isArray(event.cells) || event.cells.length > side * side)
        throw new TypeError("Invalid capture cells");
      let previous = -1;
      const cells = readArray(event.cells, event.cells.length, "cells").map((cell) => {
        const index = readInteger(cell, previous + 1, side * side - 1, "cell");
        previous = index;
        return index;
      });
      return { type, playerId: playerId(event.playerId), cells };
    }
    if (type === "zone-shrink") {
      const event = readRecord(item, ["type", "size"], "zone event");
      const size = readInteger(event.size, 1, side - 2, "zone size");
      if ((side - size) % 2 !== 0) throw new TypeError("Invalid zone size");
      return { type, size };
    }
    if (type === "death") {
      const event = readRecord(item, ["type", "playerId", "position", "causes"], "death event");
      return {
        type,
        playerId: playerId(event.playerId),
        position: position(event.position),
        causes: readCauses(event.causes),
      };
    }
    throw new TypeError("Unknown Royale event");
  });
}

const parsedCommon = new WeakMap<
  object,
  {
    tick: unknown;
    maxTicks: unknown;
    zone: unknown;
    players: unknown;
    eliminated: unknown;
    events: unknown;
    parsed: DeepReadonly<RoyaleObservation>;
  }
>();

/** Board grids that arrive as engine snapshots stay shared; callers must not mutate them. */
export function parseRoyaleObservation(raw: unknown): DeepReadonly<RoyaleObservation> {
  const value = readRecord(
    raw,
    ["tick", "maxTicks", "selfId", "selfSlot", "board", "zone", "players", "eliminated", "events"],
    "Royale observation",
  );
  const cacheKey =
    isJsonSnapshot(raw) && value.board !== null && typeof value.board === "object"
      ? value.board
      : undefined;
  const cached = cacheKey ? parsedCommon.get(cacheKey) : undefined;
  if (
    cached &&
    cached.tick === value.tick &&
    cached.maxTicks === value.maxTicks &&
    cached.zone === value.zone &&
    cached.players === value.players &&
    cached.eliminated === value.eliminated &&
    cached.events === value.events
  ) {
    const selfSlot = readInteger(
      value.selfSlot,
      0,
      cached.parsed.players.length + cached.parsed.eliminated.length - 1,
      "selfSlot",
    );
    const selfId = readId(value.selfId);
    if (!cached.parsed.players.some((player) => player.id === selfId && player.slot === selfSlot))
      throw new TypeError("Royale observation identity mismatch");
    return { ...cached.parsed, selfId, selfSlot };
  }
  if (
    !Array.isArray(value.players) ||
    !Array.isArray(value.eliminated) ||
    value.players.length < 2 ||
    value.players.length + value.eliminated.length > 5
  )
    throw new TypeError("Royale observation must list 2–5 players with at least two alive");
  const count = value.players.length + value.eliminated.length;
  const side = royaleMapSize(count);
  const b = readRecord(value.board, ["width", "height", "territory", "trails"], "board");
  if (b.width !== side || b.height !== side || value.maxTicks !== ROYALE_MAX_TICKS)
    throw new TypeError("Unsupported Royale map size or tick limit");
  const tick = readInteger(value.tick, 0, ROYALE_MAX_TICKS - 1, "tick");
  const board = {
    width: side,
    height: side,
    territory: readGrid(b.territory, side * side, count, "territory", true),
    trails: readGrid(b.trails, side * side, count, "trails", true),
  };
  const areas = royaleAreas(board.territory, count);
  const slots = new Set<number>();
  const ids = new Set<string>();
  const seat = (rawSlot: unknown, rawId: unknown) => {
    const slot = readInteger(rawSlot, 0, count - 1, "slot");
    const id = readId(rawId);
    if (slots.has(slot) || ids.has(id)) throw new TypeError("Duplicate Royale participant");
    slots.add(slot);
    ids.add(id);
    return { id, slot };
  };
  const players = readArray(value.players, value.players.length, "players").map(
    (rawPlayer): RoyaleVisiblePlayer => {
      const p = readRecord(rawPlayer, ["id", "slot", "position", "spawn", "area"], "player");
      const { id, slot } = seat(p.slot, p.id);
      const visible = {
        id,
        slot,
        position: readPosition(p.position, side, "position"),
        spawn: readPosition(p.spawn, side, "spawn"),
        area: readInteger(p.area, 0, side * side, "area"),
      };
      if (visible.area !== areas[slot]) throw new TypeError("Visible area differs from the board");
      return visible;
    },
  );
  const eliminated = readArray(value.eliminated, value.eliminated.length, "eliminated").map(
    (rawPlayer): RoyaleEliminated => {
      const p = readRecord(rawPlayer, ["id", "slot", "tick", "causes"], "eliminated player");
      const { id, slot } = seat(p.slot, p.id);
      return {
        id,
        slot,
        tick: readInteger(p.tick, 1, tick, "death tick"),
        causes: readCauses(p.causes),
      };
    },
  );
  for (const list of [players, eliminated])
    if (list.some((p, index) => index > 0 && p.slot < list[index - 1]!.slot))
      throw new TypeError("Royale players are listed by slot");
  const z = readRecord(value.zone, ["size", "target", "min", "ticksToNextShrink"], "zone");
  const zone = royaleZone(tick, side, readInteger(z.size, 1, side, "zone size"), players.length);
  const min = readRecord(z.min, ["x", "y"], "zone.min");
  if (
    (side - zone.size) % 2 !== 0 ||
    zone.size < zone.target - 1 ||
    z.target !== zone.target ||
    min.x !== zone.min.x ||
    min.y !== zone.min.y ||
    z.ticksToNextShrink !== zone.ticksToNextShrink
  )
    throw new TypeError("Inconsistent safe zone");
  const living = new Set(players.map((p) => p.slot));
  for (let cell = 0; cell < board.territory.length; cell++) {
    const land = board.territory[cell]!;
    const trail = board.trails[cell]!;
    if (land < 0 && trail < 0) continue;
    if (
      (land >= 0 && !living.has(land)) ||
      (trail >= 0 && !living.has(trail)) ||
      land === trail ||
      !insideZone(side, zone.size, cell % side, (cell / side) | 0)
    )
      throw new TypeError(
        "Only living players own cells, only inside the zone, and no trail on own land",
      );
  }
  const heads = new Set<number>();
  for (const p of players) {
    const cell = p.position.y * side + p.position.x;
    heads.add(cell);
    if (
      !insideZone(side, zone.size, p.position.x, p.position.y) ||
      (board.territory[cell] === p.slot
        ? board.trails.includes(p.slot)
        : board.trails[cell] !== p.slot)
    )
      throw new TypeError("Inconsistent visible head and trail");
  }
  if (
    heads.size !== players.length ||
    new Set(players.map((p) => p.spawn.y * side + p.spawn.x)).size !== players.length
  )
    throw new TypeError("Royale heads and spawns must be distinct");
  const selfSlot = readInteger(value.selfSlot, 0, count - 1, "selfSlot");
  const selfId = readId(value.selfId);
  if (!players.some((p) => p.id === selfId && p.slot === selfSlot))
    throw new TypeError("Royale observation identity mismatch");
  const previousEvents = readEvents(value.events, [...ids], side);
  if (tick === 0 && (previousEvents.length || eliminated.length))
    throw new TypeError("The initial observation has no history");
  const parsed: RoyaleObservation = {
    tick,
    maxTicks: ROYALE_MAX_TICKS,
    selfId,
    selfSlot,
    board,
    zone,
    players,
    eliminated,
    events: previousEvents,
  };
  if (cacheKey)
    parsedCommon.set(cacheKey, {
      tick: value.tick,
      maxTicks: value.maxTicks,
      zone: value.zone,
      players: value.players,
      eliminated: value.eliminated,
      events: value.events,
      parsed: snapshotJson(parsed),
    });
  return parsed;
}

const commonViews = new WeakMap<
  object,
  {
    events: DeepReadonly<RoyaleEvent[]> | undefined;
    base: DeepReadonly<Omit<RoyaleObservation, "selfId" | "selfSlot">>;
  }
>();

export function observeRoyale(
  state: DeepReadonly<RoyaleState>,
  playerId: string,
  context?: { events: DeepReadonly<RoyaleEvent[]> },
): RoyaleObservation | null {
  const snapshot = viewRoyaleState(state);
  const self = snapshot.players.find((p) => p.id === playerId);
  if (!self) throw new TypeError("Unknown Royale player");
  if (self.death || royaleFinished(snapshot)) return null;
  const known =
    isJsonSnapshot(state) && (context?.events === undefined || isJsonSnapshot(context.events));
  const cached = known ? commonViews.get(state) : undefined;
  if (cached && cached.events === context?.events)
    return { ...cached.base, selfId: self.id, selfSlot: self.slot } as RoyaleObservation;
  const areas = royaleAreas(snapshot.territory, snapshot.players.length);
  const players: RoyaleVisiblePlayer[] = [];
  const eliminated: RoyaleEliminated[] = [];
  for (const p of snapshot.players) {
    if (p.position)
      players.push({
        id: p.id,
        slot: p.slot,
        position: { ...p.position },
        spawn: { ...p.spawn },
        area: areas[p.slot]!,
      });
    else if (p.death)
      eliminated.push({ id: p.id, slot: p.slot, tick: p.death.tick, causes: [...p.death.causes] });
  }
  const base = {
    tick: snapshot.tick,
    maxTicks: snapshot.maxTicks,
    board: {
      width: snapshot.width,
      height: snapshot.height,
      // Engine snapshot grids are immutable and shared; any other state was copied above.
      territory: snapshot.territory as number[],
      trails: snapshot.trails as number[],
    },
    zone: royaleZone(snapshot.tick, snapshot.width, snapshot.zoneSize, players.length),
    players,
    eliminated,
    events: readEvents(
      context?.events ?? [],
      snapshot.players.map((p) => p.id),
      snapshot.width,
    ),
  };
  const shared = known ? snapshotJson(base) : base;
  if (known) commonViews.set(state, { events: context?.events, base: shared });
  return { ...shared, selfId: self.id, selfSlot: self.slot } as RoyaleObservation;
}
