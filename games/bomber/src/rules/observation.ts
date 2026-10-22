import { isJsonSnapshot, snapshotJson, type DeepReadonly } from "@si-arena/protocol";
import {
  BOMBER_CELLS,
  BOMBER_COLLAPSE_RINGS,
  BOMBER_CONFIG,
  BOMBER_HEIGHT,
  BOMBER_MAX_PLAYERS,
  BOMBER_MAX_TICKS,
  BOMBER_WIDTH,
  CELL_EMPTY,
  collapsedRings,
} from "../constants";
import type {
  BomberCollapse,
  BomberEliminated,
  BomberEvent,
  BomberObservation,
  BomberState,
  BomberVisiblePlayer,
} from "../sdk";
import {
  MAX_SCORE,
  cellIndex,
  readBombs,
  readCauses,
  readCells,
  readKind,
  readPosition,
  readPowerups,
  viewBomberState,
} from "./state";
import { readArray, readId, readInteger, readRecord } from "./validation";

/** A game is over once at most one player is alive or the tick limit is reached. */
export function bomberFinished(state: DeepReadonly<BomberState>): boolean {
  return (
    state.tick >= state.maxTicks || state.players.filter((player) => !player.death).length <= 1
  );
}

/** The collapse schedule as players see it after `tick` completed ticks. */
export function bomberCollapse(tick: number): BomberCollapse {
  const ring = collapsedRings(tick);
  const due = BOMBER_CONFIG.collapseStart + BOMBER_CONFIG.collapseInterval * ring;
  const pending = ring < BOMBER_COLLAPSE_RINGS;
  return {
    startTick: BOMBER_CONFIG.collapseStart,
    interval: BOMBER_CONFIG.collapseInterval,
    nextRing: pending ? ring : null,
    ticksToNextCollapse: pending ? due - tick : null,
  };
}

/** Each tick yields at most a move or bomb, a pickup and a death per player plus one explosion and one collapse. */
const maxEvents = (players: number) => players * 3 + 2;

function readCellList(raw: unknown, min: number, label: string): number[] {
  if (!Array.isArray(raw) || raw.length < min || raw.length > BOMBER_CELLS)
    throw new TypeError(`Invalid ${label}`);
  let previous = -1;
  return readArray(raw, raw.length, label).map((cell) => {
    const index = readInteger(cell, previous + 1, BOMBER_CELLS - 1, label);
    previous = index;
    return index;
  });
}

export function readEvents(raw: unknown, slots: ReadonlyMap<string, number>): BomberEvent[] {
  if (!Array.isArray(raw) || raw.length > maxEvents(slots.size))
    throw new TypeError("Invalid Bomber events");
  const playerId = (rawId: unknown) => {
    const id = readId(rawId);
    if (!slots.has(id)) throw new TypeError("Unknown event player");
    return id;
  };
  return readArray(raw, raw.length, "events").map((item): BomberEvent => {
    if (item === null || typeof item !== "object") throw new TypeError("Invalid event");
    const type = Object.getOwnPropertyDescriptor(item, "type")?.value;
    if (type === "move") {
      const event = readRecord(item, ["type", "playerId", "from", "to"], "move event");
      return {
        type,
        playerId: playerId(event.playerId),
        from: readPosition(event.from, "from"),
        to: readPosition(event.to, "to"),
      };
    }
    if (type === "bomb-placed") {
      const event = readRecord(item, ["type", "playerId", "position"], "bomb event");
      return {
        type,
        playerId: playerId(event.playerId),
        position: readPosition(event.position, "position"),
      };
    }
    if (type === "explosion") {
      const event = readRecord(item, ["type", "bombs", "cells", "destroyed"], "explosion event");
      if (
        !Array.isArray(event.bombs) ||
        event.bombs.length < 1 ||
        event.bombs.length > BOMBER_CONFIG.maxBombs * slots.size
      )
        throw new TypeError("Invalid exploded bombs");
      const bombs = readArray(event.bombs, event.bombs.length, "bombs").map((rawBomb) => {
        const bomb = readRecord(rawBomb, ["position", "ownerId"], "exploded bomb");
        return {
          position: readPosition(bomb.position, "position"),
          ownerId: playerId(bomb.ownerId),
        };
      });
      return {
        type,
        bombs,
        cells: readCellList(event.cells, 1, "flame cells"),
        destroyed: readCellList(event.destroyed, 0, "destroyed cells"),
      };
    }
    if (type === "pickup") {
      const event = readRecord(item, ["type", "playerId", "kind", "position"], "pickup event");
      return {
        type,
        playerId: playerId(event.playerId),
        kind: readKind(event.kind),
        position: readPosition(event.position, "position"),
      };
    }
    if (type === "collapse") {
      const event = readRecord(item, ["type", "ring", "cells"], "collapse event");
      return {
        type,
        ring: readInteger(event.ring, 0, BOMBER_COLLAPSE_RINGS - 1, "ring"),
        cells: readCellList(event.cells, 1, "collapsed cells"),
      };
    }
    if (type === "death") {
      const event = readRecord(
        item,
        ["type", "playerId", "position", "causes", "killerIds"],
        "death event",
      );
      const victim = playerId(event.playerId);
      if (!Array.isArray(event.killerIds) || event.killerIds.length >= slots.size)
        throw new TypeError("Invalid killers");
      let previous = -1;
      const killerIds = readArray(event.killerIds, event.killerIds.length, "killerIds").map(
        (rawId) => {
          const id = playerId(rawId);
          const slot = slots.get(id)!;
          if (id === victim || slot <= previous)
            throw new TypeError("Killers are other players by slot");
          previous = slot;
          return id;
        },
      );
      return {
        type,
        playerId: victim,
        position: readPosition(event.position, "position"),
        causes: readCauses(event.causes),
        killerIds,
      };
    }
    throw new TypeError("Unknown Bomber event");
  });
}

const parsedCommon = new WeakMap<
  object,
  {
    tick: unknown;
    maxTicks: unknown;
    bombs: unknown;
    powerups: unknown;
    collapse: unknown;
    players: unknown;
    eliminated: unknown;
    events: unknown;
    parsed: DeepReadonly<BomberObservation>;
  }
>();

/** Board grids that arrive as engine snapshots stay shared; callers must not mutate them. */
export function parseBomberObservation(raw: unknown): DeepReadonly<BomberObservation> {
  const value = readRecord(
    raw,
    [
      "tick",
      "maxTicks",
      "selfId",
      "selfSlot",
      "board",
      "bombs",
      "powerups",
      "collapse",
      "players",
      "eliminated",
      "events",
    ],
    "Bomber observation",
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
    cached.bombs === value.bombs &&
    cached.powerups === value.powerups &&
    cached.collapse === value.collapse &&
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
      throw new TypeError("Bomber observation identity mismatch");
    return { ...cached.parsed, selfId, selfSlot };
  }
  if (
    !Array.isArray(value.players) ||
    !Array.isArray(value.eliminated) ||
    value.players.length < 2 ||
    value.players.length + value.eliminated.length > BOMBER_MAX_PLAYERS
  )
    throw new TypeError("Bomber observation must list 2–4 players with at least two alive");
  const count = value.players.length + value.eliminated.length;
  const b = readRecord(value.board, ["width", "height", "cells"], "board");
  if (b.width !== BOMBER_WIDTH || b.height !== BOMBER_HEIGHT || value.maxTicks !== BOMBER_MAX_TICKS)
    throw new TypeError("Unsupported Bomber map size or tick limit");
  const tick = readInteger(value.tick, 0, BOMBER_MAX_TICKS - 1, "tick");
  const board = {
    width: BOMBER_WIDTH,
    height: BOMBER_HEIGHT,
    cells: readCells(b.cells, tick, true),
  };
  const slots = new Map<string, number>();
  const seen = new Set<number>();
  const seat = (rawSlot: unknown, rawId: unknown) => {
    const slot = readInteger(rawSlot, 0, count - 1, "slot");
    const id = readId(rawId);
    if (seen.has(slot) || slots.has(id)) throw new TypeError("Duplicate Bomber participant");
    seen.add(slot);
    slots.set(id, slot);
    return { id, slot };
  };
  const players = readArray(value.players, value.players.length, "players").map(
    (rawPlayer): BomberVisiblePlayer => {
      const p = readRecord(
        rawPlayer,
        ["id", "slot", "position", "bombsMax", "fireRange", "activeBombs", "score"],
        "player",
      );
      const { id, slot } = seat(p.slot, p.id);
      return {
        id,
        slot,
        position: readPosition(p.position, "position"),
        bombsMax: readInteger(
          p.bombsMax,
          BOMBER_CONFIG.initialBombs,
          BOMBER_CONFIG.maxBombs,
          "bombsMax",
        ),
        fireRange: readInteger(
          p.fireRange,
          BOMBER_CONFIG.initialRange,
          BOMBER_CONFIG.maxRange,
          "fireRange",
        ),
        activeBombs: readInteger(p.activeBombs, 0, BOMBER_CONFIG.maxBombs, "activeBombs"),
        score: readInteger(p.score, 0, MAX_SCORE, "score"),
      };
    },
  );
  const eliminated = readArray(value.eliminated, value.eliminated.length, "eliminated").map(
    (rawPlayer): BomberEliminated => {
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
      throw new TypeError("Bomber players are listed by slot");
  const limits: Array<number | undefined> = [];
  for (const p of players) limits[p.slot] = p.bombsMax;
  const { bombs, perOwner } = readBombs(value.bombs, board.cells, count, limits);
  const powerups = readPowerups(value.powerups, board.cells, bombs);
  const items = new Set(powerups.map((item) => cellIndex(item.position)));
  for (const p of players) {
    if (board.cells[cellIndex(p.position)] !== CELL_EMPTY || items.has(cellIndex(p.position)))
      throw new TypeError("A living player stands on an empty cell without a powerup");
    if (p.activeBombs !== perOwner[p.slot])
      throw new TypeError("Active bombs differ from the bombs on the map");
  }
  const c = readRecord(
    value.collapse,
    ["startTick", "interval", "nextRing", "ticksToNextCollapse"],
    "collapse",
  );
  const collapse = bomberCollapse(tick);
  if (
    c.startTick !== collapse.startTick ||
    c.interval !== collapse.interval ||
    c.nextRing !== collapse.nextRing ||
    c.ticksToNextCollapse !== collapse.ticksToNextCollapse
  )
    throw new TypeError("Inconsistent collapse schedule");
  const selfSlot = readInteger(value.selfSlot, 0, count - 1, "selfSlot");
  const selfId = readId(value.selfId);
  if (!players.some((p) => p.id === selfId && p.slot === selfSlot))
    throw new TypeError("Bomber observation identity mismatch");
  const previousEvents = readEvents(value.events, slots);
  if (tick === 0 && (previousEvents.length || eliminated.length))
    throw new TypeError("The initial observation has no history");
  const parsed: BomberObservation = {
    tick,
    maxTicks: BOMBER_MAX_TICKS,
    selfId,
    selfSlot,
    board,
    bombs,
    powerups,
    collapse,
    players,
    eliminated,
    events: previousEvents,
  };
  if (cacheKey)
    parsedCommon.set(cacheKey, {
      tick: value.tick,
      maxTicks: value.maxTicks,
      bombs: value.bombs,
      powerups: value.powerups,
      collapse: value.collapse,
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
    events: DeepReadonly<BomberEvent[]> | undefined;
    base: DeepReadonly<Omit<BomberObservation, "selfId" | "selfSlot">>;
  }
>();

export function observeBomber(
  state: DeepReadonly<BomberState>,
  playerId: string,
  context?: { events: DeepReadonly<BomberEvent[]> },
): BomberObservation | null {
  const snapshot = viewBomberState(state);
  const self = snapshot.players.find((p) => p.id === playerId);
  if (!self) throw new TypeError("Unknown Bomber player");
  if (self.death || bomberFinished(snapshot)) return null;
  const known =
    isJsonSnapshot(state) && (context?.events === undefined || isJsonSnapshot(context.events));
  const cached = known ? commonViews.get(state) : undefined;
  if (cached && cached.events === context?.events)
    return { ...cached.base, selfId: self.id, selfSlot: self.slot } as BomberObservation;
  const active = snapshot.players.map(() => 0);
  for (const bomb of snapshot.bombs) active[bomb.owner]!++;
  const players: BomberVisiblePlayer[] = [];
  const eliminated: BomberEliminated[] = [];
  const slots = new Map<string, number>();
  for (const p of snapshot.players) {
    slots.set(p.id, p.slot);
    if (p.position)
      players.push({
        id: p.id,
        slot: p.slot,
        position: { ...p.position },
        bombsMax: p.bombsMax,
        fireRange: p.fireRange,
        activeBombs: active[p.slot]!,
        score: p.score,
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
      cells: snapshot.cells as number[],
    },
    bombs: snapshot.bombs.map((bomb) => ({ ...bomb, position: { ...bomb.position } })),
    powerups: snapshot.powerups.map((item) => ({ ...item, position: { ...item.position } })),
    collapse: bomberCollapse(snapshot.tick),
    players,
    eliminated,
    events: readEvents(context?.events ?? [], slots),
  };
  const shared = known ? snapshotJson(base) : base;
  if (known) commonViews.set(state, { events: context?.events, base: shared });
  return { ...shared, selfId: self.id, selfSlot: self.slot } as BomberObservation;
}
