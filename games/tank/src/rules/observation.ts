import { isJsonSnapshot, snapshotJson, type DeepReadonly } from "@si-arena/protocol";
import { TANK_CELLS, TANK_CONFIG, TANK_MAX_TICKS, TANK_PLAYERS } from "../constants";
import type {
  TankEliminated,
  TankEvent,
  TankObservation,
  TankState,
  TankVisibleBullet,
  TankVisibleTank,
} from "../sdk";
import {
  cellIndex,
  readCells,
  readDirection,
  readPosition,
  samePosition,
  viewTankState,
} from "./state";
import { readArray, readId, readInteger, readRecord } from "./validation";

/** A game is over once a tank is destroyed or the tick limit is reached. */
export function tankFinished(state: DeepReadonly<TankState>): boolean {
  return state.tick >= state.maxTicks || state.tanks.some((tank) => tank.death !== null);
}

/** Per tick at most: 2 moves, 2 fires, 2 hits, 2 brick lists, 1 cancellation, 2 deaths. */
const MAX_EVENTS = 11;

const eventPosition = (rawPoint: unknown) => readPosition(rawPoint, "event position");

function readEvents(raw: unknown, ids: readonly string[]): TankEvent[] {
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS) throw new TypeError("Invalid Tank events");
  const playerId = (rawId: unknown) => {
    const id = readId(rawId);
    if (!ids.includes(id)) throw new TypeError("Unknown event player");
    return id;
  };
  return readArray(raw, raw.length, "events").map((item): TankEvent => {
    if (item === null || typeof item !== "object") throw new TypeError("Invalid event");
    const type = Object.getOwnPropertyDescriptor(item, "type")?.value;
    if (type === "move") {
      const event = readRecord(item, ["type", "playerId", "from", "to", "facing"], "move event");
      return {
        type,
        playerId: playerId(event.playerId),
        from: eventPosition(event.from),
        to: eventPosition(event.to),
        facing: readDirection(event.facing, "move facing"),
      };
    }
    if (type === "fire") {
      const event = readRecord(item, ["type", "playerId", "position", "direction"], "fire event");
      return {
        type,
        playerId: playerId(event.playerId),
        position: eventPosition(event.position),
        direction: readDirection(event.direction, "fire direction"),
      };
    }
    if (type === "hit") {
      const event = readRecord(
        item,
        ["type", "playerId", "attackerId", "position", "hp"],
        "hit event",
      );
      const victim = playerId(event.playerId);
      const attacker = playerId(event.attackerId);
      if (victim === attacker) throw new TypeError("A bullet never hits its own tank");
      return {
        type,
        playerId: victim,
        attackerId: attacker,
        position: eventPosition(event.position),
        hp: readInteger(event.hp, 0, TANK_CONFIG.initialHp - 1, "hit hp"),
      };
    }
    if (type === "brick-destroyed") {
      const event = readRecord(item, ["type", "attackerId", "cells"], "brick event");
      if (!Array.isArray(event.cells) || event.cells.length < 1 || event.cells.length > TANK_CELLS)
        throw new TypeError("Invalid destroyed cells");
      let previous = -1;
      const cells = readArray(event.cells, event.cells.length, "cells").map((cell) => {
        const index = readInteger(cell, previous + 1, TANK_CELLS - 1, "cell");
        previous = index;
        return index;
      });
      return { type, attackerId: playerId(event.attackerId), cells };
    }
    if (type === "bullets-cancelled") {
      const event = readRecord(item, ["type", "position"], "cancel event");
      return { type, position: eventPosition(event.position) };
    }
    if (type === "death") {
      const event = readRecord(item, ["type", "playerId", "position"], "death event");
      return { type, playerId: playerId(event.playerId), position: eventPosition(event.position) };
    }
    throw new TypeError("Unknown Tank event");
  });
}

const parsedCommon = new WeakMap<
  object,
  {
    tick: unknown;
    maxTicks: unknown;
    tanks: unknown;
    bullets: unknown;
    eliminated: unknown;
    events: unknown;
    parsed: DeepReadonly<TankObservation>;
  }
>();

const identity = (
  tanks: readonly { readonly id: string; readonly slot: number }[],
  rawSlot: unknown,
  rawId: unknown,
) => {
  const selfSlot = readInteger(rawSlot, 0, TANK_PLAYERS - 1, "selfSlot");
  const selfId = readId(rawId);
  if (!tanks.some((tank) => tank.id === selfId && tank.slot === selfSlot))
    throw new TypeError("Tank observation identity mismatch");
  return { selfId, selfSlot };
};

/** Terrain that arrives as an engine snapshot stays shared; callers must not mutate it. */
export function parseTankObservation(raw: unknown): DeepReadonly<TankObservation> {
  const value = readRecord(
    raw,
    ["tick", "maxTicks", "selfId", "selfSlot", "board", "tanks", "bullets", "eliminated", "events"],
    "Tank observation",
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
    cached.tanks === value.tanks &&
    cached.bullets === value.bullets &&
    cached.eliminated === value.eliminated &&
    cached.events === value.events
  )
    return { ...cached.parsed, ...identity(cached.parsed.tanks, value.selfSlot, value.selfId) };
  const b = readRecord(value.board, ["width", "height", "cells"], "board");
  if (
    b.width !== TANK_CONFIG.width ||
    b.height !== TANK_CONFIG.height ||
    value.maxTicks !== TANK_MAX_TICKS
  )
    throw new TypeError("Unsupported Tank map size or tick limit");
  const tick = readInteger(value.tick, 0, TANK_MAX_TICKS - 1, "tick");
  const board = {
    width: TANK_CONFIG.width,
    height: TANK_CONFIG.height,
    cells: readCells(b.cells, "cells", true),
  };
  if (!Array.isArray(value.bullets) || value.bullets.length > TANK_PLAYERS)
    throw new TypeError("At most one bullet per tank is in flight");
  const owners = new Set<number>();
  const bullets = readArray(value.bullets, value.bullets.length, "bullets").map(
    (rawBullet): TankVisibleBullet => {
      const bullet = readRecord(rawBullet, ["position", "direction", "ownerSlot"], "bullet");
      const ownerSlot = readInteger(bullet.ownerSlot, 0, TANK_PLAYERS - 1, "ownerSlot");
      if (owners.has(ownerSlot)) throw new TypeError("Each tank has at most one bullet");
      owners.add(ownerSlot);
      const position = readPosition(bullet.position, "bullet position");
      if (board.cells[cellIndex(position)] !== 0)
        throw new TypeError("Bullets fly over empty cells");
      return {
        position,
        direction: readDirection(bullet.direction, "bullet direction"),
        ownerSlot,
      };
    },
  );
  const tanks = readArray(value.tanks, TANK_PLAYERS, "tanks").map(
    (rawTank, slot): TankVisibleTank => {
      const t = readRecord(
        rawTank,
        ["id", "slot", "position", "facing", "hp", "bulletInFlight"],
        "tank",
      );
      if (t.slot !== slot) throw new TypeError("Tanks are listed by slot");
      if (t.bulletInFlight !== owners.has(slot))
        throw new TypeError("bulletInFlight differs from the bullets in flight");
      const visible = {
        id: readId(t.id),
        slot,
        position: readPosition(t.position, "position"),
        facing: readDirection(t.facing, "facing"),
        hp: readInteger(t.hp, 1, TANK_CONFIG.initialHp, "hp"),
        bulletInFlight: owners.has(slot),
      };
      if (board.cells[cellIndex(visible.position)] !== 0)
        throw new TypeError("A tank stands on an empty cell");
      return visible;
    },
  );
  if (tanks[0]!.id === tanks[1]!.id || samePosition(tanks[0]!.position, tanks[1]!.position))
    throw new TypeError("Tank IDs and positions must be distinct");
  readArray(value.eliminated, 0, "eliminated");
  const previousEvents = readEvents(
    value.events,
    tanks.map((tank) => tank.id),
  );
  if (tick === 0 && previousEvents.length)
    throw new TypeError("The initial observation has no history");
  const parsed: TankObservation = {
    tick,
    maxTicks: TANK_MAX_TICKS,
    ...identity(tanks, value.selfSlot, value.selfId),
    board,
    tanks,
    bullets,
    eliminated: [],
    events: previousEvents,
  };
  if (cacheKey)
    parsedCommon.set(cacheKey, {
      tick: value.tick,
      maxTicks: value.maxTicks,
      tanks: value.tanks,
      bullets: value.bullets,
      eliminated: value.eliminated,
      events: value.events,
      parsed: snapshotJson(parsed),
    });
  return parsed;
}

const commonViews = new WeakMap<
  object,
  {
    events: DeepReadonly<TankEvent[]> | undefined;
    base: DeepReadonly<Omit<TankObservation, "selfId" | "selfSlot">>;
  }
>();

export function observeTank(
  state: DeepReadonly<TankState>,
  playerId: string,
  context?: { events: DeepReadonly<TankEvent[]> },
): TankObservation | null {
  const snapshot = viewTankState(state);
  const self = snapshot.tanks.find((tank) => tank.id === playerId);
  if (!self) throw new TypeError("Unknown Tank player");
  if (self.death || tankFinished(snapshot)) return null;
  const known =
    isJsonSnapshot(state) && (context?.events === undefined || isJsonSnapshot(context.events));
  const cached = known ? commonViews.get(state) : undefined;
  if (cached && cached.events === context?.events)
    return { ...cached.base, selfId: self.id, selfSlot: self.slot } as TankObservation;
  const base = {
    tick: snapshot.tick,
    maxTicks: snapshot.maxTicks,
    // Engine snapshot terrain is immutable and shared; any other state was copied above.
    board: { width: snapshot.width, height: snapshot.height, cells: snapshot.cells as number[] },
    tanks: snapshot.tanks.map((tank): TankVisibleTank => ({
      id: tank.id,
      slot: tank.slot,
      position: { ...tank.position! },
      facing: tank.facing,
      hp: tank.hp,
      bulletInFlight: snapshot.bullets.some((bullet) => bullet.owner === tank.slot),
    })),
    bullets: snapshot.bullets.map((bullet): TankVisibleBullet => ({
      position: { ...bullet.position },
      direction: bullet.direction,
      ownerSlot: bullet.owner,
    })),
    eliminated: [] as TankEliminated[],
    events: readEvents(
      context?.events ?? [],
      snapshot.tanks.map((tank) => tank.id),
    ),
  };
  const shared = known ? snapshotJson(base) : base;
  if (known) commonViews.set(state, { events: context?.events, base: shared });
  return { ...shared, selfId: self.id, selfSlot: self.slot } as TankObservation;
}
