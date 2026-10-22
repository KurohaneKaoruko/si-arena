import { isJsonSnapshot, snapshotJson, type DeepReadonly } from "@si-arena/protocol";
import { SNAKE_CONFIG, SNAKE_MAX_TICKS, snakeMapSize } from "../constants";
import type {
  SnakeEliminated,
  SnakeEvent,
  SnakeObservation,
  SnakeState,
  SnakeVisibleSnake,
} from "../sdk";
import {
  readBody,
  readCauses,
  readDirection,
  readFood,
  readPosition,
  readTarget,
  samePoint,
  viewSnakeState,
  type Occupied,
} from "./state";
import { readArray, readId, readInteger, readRecord } from "./validation";

/** A game is over once at most one snake is alive or the tick limit is reached. */
export function snakeFinished(state: DeepReadonly<SnakeState>): boolean {
  return state.tick >= state.maxTicks || state.snakes.filter((snake) => !snake.death).length <= 1;
}

/** Each tick yields at most a move, eat and death per snake plus two food spawns. */
const maxEvents = (players: number) => players * 3 + 2;

function readEvents(raw: unknown, ids: readonly string[], side: number): SnakeEvent[] {
  if (!Array.isArray(raw) || raw.length > maxEvents(ids.length))
    throw new TypeError("Invalid Snake events");
  const playerId = (rawId: unknown) => {
    const id = readId(rawId);
    if (!ids.includes(id)) throw new TypeError("Unknown event player");
    return id;
  };
  return readArray(raw, raw.length, "events").map((item): SnakeEvent => {
    if (item === null || typeof item !== "object") throw new TypeError("Invalid event");
    const type = Object.getOwnPropertyDescriptor(item, "type")?.value;
    if (type === "move") {
      const event = readRecord(item, ["type", "playerId", "from", "to"], "move event");
      return {
        type,
        playerId: playerId(event.playerId),
        from: readPosition(event.from, side, "event from"),
        to: readTarget(event.to, side, "event to"),
      };
    }
    if (type === "eat") {
      const event = readRecord(item, ["type", "playerId", "position"], "eat event");
      return {
        type,
        playerId: playerId(event.playerId),
        position: readPosition(event.position, side, "event position"),
      };
    }
    if (type === "death") {
      const event = readRecord(item, ["type", "playerId", "position", "causes"], "death event");
      return {
        type,
        playerId: playerId(event.playerId),
        position: readTarget(event.position, side, "event position"),
        causes: readCauses(event.causes),
      };
    }
    if (type === "food-spawn") {
      const event = readRecord(item, ["type", "position"], "food event");
      return { type, position: readPosition(event.position, side, "event position") };
    }
    throw new TypeError("Unknown Snake event");
  });
}

const parsedCommon = new WeakMap<
  object,
  {
    tick: unknown;
    maxTicks: unknown;
    board: unknown;
    eliminated: unknown;
    food: unknown;
    events: unknown;
    parsed: DeepReadonly<SnakeObservation>;
  }
>();

/** Lists that arrive as engine snapshots stay shared; callers must not mutate them. */
export function parseSnakeObservation(raw: unknown): DeepReadonly<SnakeObservation> {
  const value = readRecord(
    raw,
    ["tick", "maxTicks", "selfId", "selfSlot", "board", "snakes", "eliminated", "food", "events"],
    "Snake observation",
  );
  const cacheKey =
    isJsonSnapshot(raw) && value.snakes !== null && typeof value.snakes === "object"
      ? value.snakes
      : undefined;
  const cached = cacheKey ? parsedCommon.get(cacheKey) : undefined;
  if (
    cached &&
    cached.tick === value.tick &&
    cached.maxTicks === value.maxTicks &&
    cached.board === value.board &&
    cached.eliminated === value.eliminated &&
    cached.food === value.food &&
    cached.events === value.events
  ) {
    const selfSlot = readInteger(
      value.selfSlot,
      0,
      cached.parsed.snakes.length + cached.parsed.eliminated.length - 1,
      "selfSlot",
    );
    const selfId = readId(value.selfId);
    if (!cached.parsed.snakes.some((snake) => snake.id === selfId && snake.slot === selfSlot))
      throw new TypeError("Snake observation identity mismatch");
    return { ...cached.parsed, selfId, selfSlot };
  }
  if (
    !Array.isArray(value.snakes) ||
    !Array.isArray(value.eliminated) ||
    value.snakes.length < 2 ||
    value.snakes.length + value.eliminated.length > 4
  )
    throw new TypeError("Snake observation must list 2–4 players with at least two alive");
  const count = value.snakes.length + value.eliminated.length;
  const side = snakeMapSize(count);
  const b = readRecord(value.board, ["width", "height"], "board");
  if (b.width !== side || b.height !== side || value.maxTicks !== SNAKE_MAX_TICKS)
    throw new TypeError("Unsupported Snake map size or tick limit");
  const tick = readInteger(value.tick, 0, SNAKE_MAX_TICKS - 1, "tick");
  const slots = new Set<number>();
  const ids = new Set<string>();
  const seat = (rawSlot: unknown, rawId: unknown) => {
    const slot = readInteger(rawSlot, 0, count - 1, "slot");
    const id = readId(rawId);
    if (slots.has(slot) || ids.has(id)) throw new TypeError("Duplicate Snake participant");
    slots.add(slot);
    ids.add(id);
    return { id, slot };
  };
  const occupied: Occupied = new Set();
  const snakes = readArray(value.snakes, value.snakes.length, "snakes").map(
    (rawSnake): SnakeVisibleSnake => {
      const s = readRecord(
        rawSnake,
        ["id", "slot", "body", "head", "length", "health", "heading"],
        "snake",
      );
      const { id, slot } = seat(s.slot, s.id);
      const heading = readDirection(s.heading, "heading");
      const body = readBody(s.body, side, heading, occupied, "body", true);
      const head = readPosition(s.head, side, "head");
      if (!samePoint(head, body[0]!) || s.length !== body.length)
        throw new TypeError("Visible head and length differ from the body");
      return {
        id,
        slot,
        body,
        head,
        length: body.length,
        health: readInteger(s.health, 1, SNAKE_CONFIG.maxHealth, "health"),
        heading,
      };
    },
  );
  const eliminated = readArray(value.eliminated, value.eliminated.length, "eliminated").map(
    (rawSnake): SnakeEliminated => {
      const s = readRecord(rawSnake, ["id", "slot", "tick", "causes"], "eliminated snake");
      const { id, slot } = seat(s.slot, s.id);
      return {
        id,
        slot,
        tick: readInteger(s.tick, 1, tick, "death tick"),
        causes: readCauses(s.causes),
      };
    },
  );
  for (const list of [snakes, eliminated])
    if (list.some((s, index) => index > 0 && s.slot < list[index - 1]!.slot))
      throw new TypeError("Snakes are listed by slot");
  const food = readFood(value.food, side, occupied, true);
  const selfSlot = readInteger(value.selfSlot, 0, count - 1, "selfSlot");
  const selfId = readId(value.selfId);
  if (!snakes.some((s) => s.id === selfId && s.slot === selfSlot))
    throw new TypeError("Snake observation identity mismatch");
  const previousEvents = readEvents(value.events, [...ids], side);
  if (tick === 0 && (previousEvents.length || eliminated.length))
    throw new TypeError("The initial observation has no history");
  const parsed: SnakeObservation = {
    tick,
    maxTicks: SNAKE_MAX_TICKS,
    selfId,
    selfSlot,
    board: { width: side, height: side },
    snakes,
    eliminated,
    food,
    events: previousEvents,
  };
  if (cacheKey)
    parsedCommon.set(cacheKey, {
      tick: value.tick,
      maxTicks: value.maxTicks,
      board: value.board,
      eliminated: value.eliminated,
      food: value.food,
      events: value.events,
      parsed: snapshotJson(parsed),
    });
  return parsed;
}

const commonViews = new WeakMap<
  object,
  {
    events: DeepReadonly<SnakeEvent[]> | undefined;
    base: DeepReadonly<Omit<SnakeObservation, "selfId" | "selfSlot">>;
  }
>();

export function observeSnake(
  state: DeepReadonly<SnakeState>,
  playerId: string,
  context?: { events: DeepReadonly<SnakeEvent[]> },
): SnakeObservation | null {
  const snapshot = viewSnakeState(state);
  const self = snapshot.snakes.find((s) => s.id === playerId);
  if (!self) throw new TypeError("Unknown Snake player");
  if (self.death || snakeFinished(snapshot)) return null;
  const known =
    isJsonSnapshot(state) && (context?.events === undefined || isJsonSnapshot(context.events));
  const cached = known ? commonViews.get(state) : undefined;
  if (cached && cached.events === context?.events)
    return { ...cached.base, selfId: self.id, selfSlot: self.slot } as SnakeObservation;
  const snakes: SnakeVisibleSnake[] = [];
  const eliminated: SnakeEliminated[] = [];
  for (const s of snapshot.snakes) {
    if (s.death) {
      eliminated.push({ id: s.id, slot: s.slot, tick: s.death.tick, causes: [...s.death.causes] });
      continue;
    }
    // Engine snapshot lists are immutable and shared; any other state was copied above.
    const body = (
      known ? s.body : s.body.map((cell) => ({ ...cell }))
    ) as SnakeVisibleSnake["body"];
    snakes.push({
      id: s.id,
      slot: s.slot,
      body,
      head: { ...body[0]! },
      length: body.length,
      health: s.health,
      heading: s.heading,
    });
  }
  const base = {
    tick: snapshot.tick,
    maxTicks: snapshot.maxTicks,
    board: { width: snapshot.width, height: snapshot.height },
    snakes,
    eliminated,
    food: (known
      ? snapshot.food
      : snapshot.food.map((cell) => ({ ...cell }))) as SnakeState["food"],
    events: readEvents(
      context?.events ?? [],
      snapshot.snakes.map((s) => s.id),
      snapshot.width,
    ),
  };
  const shared = known ? snapshotJson(base) : base;
  if (known) commonViews.set(state, { events: context?.events, base: shared });
  return { ...shared, selfId: self.id, selfSlot: self.slot } as SnakeObservation;
}
