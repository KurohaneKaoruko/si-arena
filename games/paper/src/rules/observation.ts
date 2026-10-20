import type { DeepReadonly } from "@si-arena/protocol";
import { PAPER_CONFIG, PAPER_MAX_TICKS } from "../constants";
import type {
  PaperEvent,
  PaperObservation,
  PaperPosition,
  PaperResetCause,
  PaperState,
  PaperVisiblePlayer,
} from "../sdk";
import { parsePaperState, readPaperGrid } from "./state";
import { readArray, readId, readInteger, readRecord } from "./validation";

function position(raw: unknown): PaperPosition {
  const p = readRecord(raw, ["x", "y"], "position");
  return {
    x: readInteger(p.x, 0, PAPER_CONFIG.width - 1, "x"),
    y: readInteger(p.y, 0, PAPER_CONFIG.height - 1, "y"),
  };
}

function events(raw: unknown, ids: string[]): PaperEvent[] {
  if (!Array.isArray(raw) || raw.length > 8) throw new TypeError("Invalid Paper events");
  const playerId = (rawId: unknown) => {
    const id = readId(rawId);
    if (!ids.includes(id)) throw new TypeError("Unknown event player");
    return id;
  };
  return readArray(raw, raw.length, "events").map((item): PaperEvent => {
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
      if (
        !Array.isArray(event.cells) ||
        event.cells.length > PAPER_CONFIG.width * PAPER_CONFIG.height
      )
        throw new TypeError("Invalid capture cells");
      const cells = readArray(event.cells, event.cells.length, "cells").map((cell) =>
        readInteger(cell, 0, PAPER_CONFIG.width * PAPER_CONFIG.height - 1, "cell"),
      );
      if (new Set(cells).size !== cells.length) throw new TypeError("Duplicate capture cell");
      return { type, playerId: playerId(event.playerId), cells };
    }
    if (type === "reset") {
      const event = readRecord(item, ["type", "playerId", "from", "to", "causes"], "reset event");
      const allowed: PaperResetCause[] = [
        "boundary",
        "head-collision",
        "head-swap",
        "self-trail",
        "trail-cut",
      ];
      if (
        !Array.isArray(event.causes) ||
        event.causes.length < 1 ||
        event.causes.length > allowed.length
      )
        throw new TypeError("Invalid reset causes");
      const causes = readArray(event.causes, event.causes.length, "causes").map((cause) => {
        if (!allowed.includes(cause as PaperResetCause)) throw new TypeError("Unknown reset cause");
        return cause as PaperResetCause;
      });
      if (new Set(causes).size !== causes.length) throw new TypeError("Duplicate reset cause");
      return {
        type,
        playerId: playerId(event.playerId),
        from: position(event.from),
        to: position(event.to),
        causes,
      };
    }
    throw new TypeError("Unknown Paper event");
  });
}

export function parsePaperObservation(raw: unknown): PaperObservation {
  const value = readRecord(
    raw,
    ["tick", "maxTicks", "selfId", "selfSlot", "board", "players", "events"],
    "Paper observation",
  );
  const b = readRecord(value.board, ["width", "height", "territory", "trails"], "board");
  if (
    b.width !== PAPER_CONFIG.width ||
    b.height !== PAPER_CONFIG.height ||
    value.maxTicks !== PAPER_MAX_TICKS
  )
    throw new TypeError("Unsupported Paper dimensions or tick limit");
  const board = {
    width: PAPER_CONFIG.width,
    height: PAPER_CONFIG.height,
    territory: readPaperGrid(b.territory, "territory"),
    trails: readPaperGrid(b.trails, "trails"),
  };
  const players = readArray(value.players, 2, "players").map(
    (rawPlayer, slot): PaperVisiblePlayer => {
      const p = readRecord(rawPlayer, ["id", "slot", "position", "spawn"], "visible player");
      if (p.slot !== slot) throw new TypeError("Visible player slot mismatch");
      return {
        id: readId(p.id),
        slot: slot === 0 ? 0 : 1,
        position: position(p.position),
        spawn: position(p.spawn),
      };
    },
  ) as [PaperVisiblePlayer, PaperVisiblePlayer];
  if (
    players[0].id === players[1].id ||
    (players[0].position.x === players[1].position.x &&
      players[0].position.y === players[1].position.y) ||
    (players[0].spawn.x === players[1].spawn.x && players[0].spawn.y === players[1].spawn.y)
  )
    throw new TypeError("Paper participants must be distinct");
  for (const p of players) {
    const cell = p.position.y * board.width + p.position.x;
    if (
      board.territory[cell] === p.slot
        ? board.trails.includes(p.slot)
        : board.trails[cell] !== p.slot
    )
      throw new TypeError("Inconsistent visible head and trail");
  }
  const selfSlot = readInteger(value.selfSlot, 0, 1, "selfSlot") as 0 | 1;
  const selfId = readId(value.selfId);
  if (players[selfSlot].id !== selfId) throw new TypeError("Paper observation identity mismatch");
  const tick = readInteger(value.tick, 0, PAPER_MAX_TICKS, "tick");
  const previousEvents = events(
    value.events,
    players.map((p) => p.id),
  );
  if (tick === 0 && previousEvents.length)
    throw new TypeError("Initial observation cannot have previous events");
  return {
    tick,
    maxTicks: PAPER_MAX_TICKS,
    selfId,
    selfSlot,
    board,
    players,
    events: previousEvents,
  };
}

export function observePaper(
  state: DeepReadonly<PaperState>,
  playerId: string,
  context?: { events: DeepReadonly<PaperEvent[]> },
): PaperObservation | null {
  const snapshot = parsePaperState(state);
  const player = snapshot.players.find((p) => p.id === playerId);
  if (!player) throw new TypeError("Unknown Paper player");
  if (snapshot.tick >= PAPER_MAX_TICKS) return null;
  const players = snapshot.players.map((p): PaperVisiblePlayer => {
    if (!p.position) throw new TypeError("Missing Paper head");
    return { id: p.id, slot: p.slot, position: p.position, spawn: snapshot.spawns[p.slot] };
  }) as [PaperVisiblePlayer, PaperVisiblePlayer];
  return {
    tick: snapshot.tick,
    maxTicks: snapshot.maxTicks,
    selfId: player.id,
    selfSlot: player.slot,
    board: {
      width: snapshot.width,
      height: snapshot.height,
      territory: snapshot.territory,
      trails: snapshot.trails,
    },
    players,
    events: events(
      context?.events ?? [],
      players.map((p) => p.id),
    ),
  };
}
