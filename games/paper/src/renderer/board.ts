import type { DeepReadonly } from "@si-arena/protocol";
import type { PaperState } from "../sdk";
import type { PaperEvent } from "../rules";
import { PAPER_PALETTE } from "./palette";

/**
 * Transient presentation input for one tick. The world itself is always drawn from `state`;
 * events only add decaying highlights, interpolated head motion and error badges.
 */
export interface PaperBoardAnimation {
  previousState: DeepReadonly<PaperState>;
  events: DeepReadonly<PaperEvent[]>;
  /** Fraction of the current tick's animation window, 0..1; 1 (or a missing animation) draws the settled board. */
  progress: number;
  reducedMotion: boolean;
  /** Player ids whose execution errored on the input tick that produced the current world. */
  erroredPlayers: ReadonlySet<string>;
}

export function paperPlayerSummaries(state: DeepReadonly<PaperState>) {
  return state.players.map((player) => ({
    id: player.id,
    label: `P${player.slot + 1}`,
    color: PAPER_PALETTE.players[player.slot]!,
    score: state.territory.filter((owner) => owner === player.slot).length,
    alive: player.alive,
  }));
}

type Point = { x: number; y: number };
type MoveEvent = Extract<DeepReadonly<PaperEvent>, { type: "move" }>;

function slotOf(state: DeepReadonly<PaperState>, playerId: string): number {
  return state.players.find((player) => player.id === playerId)?.slot ?? -1;
}

function drawCross(
  context: CanvasRenderingContext2D,
  cell: Point,
  color: string,
  alpha: number,
  cellWidth: number,
  cellHeight: number,
): void {
  const x = cell.x * cellWidth,
    y = cell.y * cellHeight;
  const insetX = cellWidth * 0.22,
    insetY = cellHeight * 0.22;
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, cellWidth * 0.1);
  context.beginPath();
  context.moveTo(x + insetX, y + insetY);
  context.lineTo(x + cellWidth - insetX, y + cellHeight - insetY);
  context.moveTo(x + cellWidth - insetX, y + insetY);
  context.lineTo(x + insetX, y + cellHeight - insetY);
  context.stroke();
}

function drawRing(
  context: CanvasRenderingContext2D,
  center: Point,
  radius: number,
  color: string,
  alpha: number,
  span: number,
): void {
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, span * 0.08);
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.stroke();
}

/** Draw authoritative grid state; rendering never modifies or advances the rules. */
export function drawPaperBoard(
  context: CanvasRenderingContext2D,
  state: DeepReadonly<PaperState>,
  width: number,
  height: number,
  animation?: PaperBoardAnimation,
): void {
  const cellWidth = width / state.width,
    cellHeight = height / state.height;
  const span = Math.min(cellWidth, cellHeight);
  const progress = animation === undefined ? 1 : Math.min(1, Math.max(0, animation.progress));
  const reducedMotion = animation?.reducedMotion ?? false;
  // Transient effects animate only inside an armed window; reduced motion keeps the marks
  // of the current tick visible at a fixed intensity instead of animating them.
  const transient = animation !== undefined && !reducedMotion && progress < 1;
  const showMarks = animation !== undefined && (reducedMotion || progress < 1);
  const markAlpha = transient ? 1 - progress : 0.9;
  const events = animation?.events ?? [];
  const previousState = animation?.previousState;
  const moves = new Map<string, MoveEvent>();
  for (const event of events) {
    if (event.type === "move") moves.set(event.playerId, event);
  }

  context.save();
  context.fillStyle = PAPER_PALETTE.neutral;
  context.fillRect(0, 0, width, height);
  for (let index = 0; index < state.territory.length; index++) {
    const owner = state.territory[index]!;
    if (owner < 0) continue;
    context.fillStyle = PAPER_PALETTE.players[owner]!;
    context.globalAlpha = 0.28;
    context.fillRect(
      (index % state.width) * cellWidth,
      Math.floor(index / state.width) * cellHeight,
      cellWidth,
      cellHeight,
    );
  }
  context.globalAlpha = 1;
  context.strokeStyle = PAPER_PALETTE.grid;
  context.lineWidth = 0.5;
  context.beginPath();
  for (let x = 0; x <= state.width; x++) {
    context.moveTo(x * cellWidth, 0);
    context.lineTo(x * cellWidth, height);
  }
  for (let y = 0; y <= state.height; y++) {
    context.moveTo(0, y * cellHeight);
    context.lineTo(width, y * cellHeight);
  }
  context.stroke();
  for (let index = 0; index < state.trails.length; index++) {
    const owner = state.trails[index]!;
    if (owner < 0) continue;
    const x = (index % state.width) * cellWidth,
      y = Math.floor(index / state.width) * cellHeight;
    context.fillStyle = PAPER_PALETTE.players[owner]!;
    context.fillRect(
      x + cellWidth * 0.18,
      y + cellHeight * 0.18,
      cellWidth * 0.64,
      cellHeight * 0.64,
    );
  }
  // Captured cells flash under the heads; an empty capture closes without gaining ground.
  if (showMarks) {
    for (const event of events) {
      if (event.type !== "capture" || event.cells.length === 0) continue;
      const color = PAPER_PALETTE.players[slotOf(state, event.playerId)];
      if (!color) continue;
      for (const index of event.cells) {
        const x = (index % state.width) * cellWidth,
          y = Math.floor(index / state.width) * cellHeight;
        if (transient) {
          context.globalAlpha = 0.45 * (1 - progress);
          context.fillStyle = color;
          context.fillRect(x, y, cellWidth, cellHeight);
        } else {
          context.globalAlpha = markAlpha;
          context.strokeStyle = color;
          context.lineWidth = Math.max(1.5, cellWidth * 0.08);
          context.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
        }
      }
    }
    context.globalAlpha = 1;
  }
  const headPoints = new Map<string, Point>();
  for (const player of state.players) {
    if (!player.alive || !player.position) continue;
    const move = transient ? moves.get(player.id) : undefined;
    const gridX = move ? move.from.x + (move.to.x - move.from.x) * progress : player.position.x;
    const gridY = move ? move.from.y + (move.to.y - move.from.y) * progress : player.position.y;
    const x = gridX * cellWidth,
      y = gridY * cellHeight;
    headPoints.set(player.id, { x, y });
    context.fillStyle = PAPER_PALETTE.players[player.slot]!;
    context.fillRect(x, y, cellWidth, cellHeight);
    context.strokeStyle = PAPER_PALETTE.headOutline;
    context.lineWidth = Math.max(1, cellWidth / 10);
    context.strokeRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
    context.fillStyle = PAPER_PALETTE.neutral;
    context.font = `bold ${Math.max(7, cellHeight * 0.7)}px monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(player.slot + 1), x + cellWidth / 2, y + cellHeight / 2);
  }
  if (showMarks) {
    for (const event of events) {
      if (event.type === "trail-cut") {
        const attacker = PAPER_PALETTE.players[slotOf(state, event.attackerId)];
        if (attacker) {
          drawCross(context, event.position, attacker, markAlpha, cellWidth, cellHeight);
        }
      } else if (event.type === "reset") {
        const victim = PAPER_PALETTE.players[slotOf(state, event.playerId)];
        if (victim) {
          // The head teleports to the spawn, so the ring marks the cell it lost.
          drawRing(
            context,
            {
              x: (event.from.x + 0.5) * cellWidth,
              y: (event.from.y + 0.5) * cellHeight,
            },
            transient ? (0.175 + 0.325 * progress) * span : 0.3 * span,
            victim,
            markAlpha,
            span,
          );
        }
      } else if (event.type === "capture" && event.cells.length === 0) {
        const closer = PAPER_PALETTE.players[slotOf(state, event.playerId)];
        const position = state.players.find((player) => player.id === event.playerId)?.position;
        if (closer && position) {
          drawRing(
            context,
            {
              x: (position.x + 0.5) * cellWidth,
              y: (position.y + 0.5) * cellHeight,
            },
            transient ? (0.1 + 0.3 * progress) * span : 0.25 * span,
            closer,
            markAlpha,
            span,
          );
        }
      }
    }
    context.globalAlpha = 1;
  }
  if (animation !== undefined) {
    for (const playerId of animation.erroredPlayers) {
      // The badge follows the drawn head; a player reset this tick falls back
      // to its last position in the previous world.
      const head = headPoints.get(playerId);
      const fallback = previousState?.players.find((player) => player.id === playerId)?.position;
      const point =
        head ?? (fallback ? { x: fallback.x * cellWidth, y: fallback.y * cellHeight } : null);
      if (!point) continue;
      const radius = span * 0.24;
      const center = { x: point.x + cellWidth - radius, y: point.y + radius };
      context.globalAlpha = 1;
      context.fillStyle = PAPER_PALETTE.warning;
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = PAPER_PALETTE.warningInk;
      context.font = `bold ${Math.max(7, radius * 1.4)}px monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("!", center.x, center.y);
    }
  }
  context.globalAlpha = 1;
  context.restore();
}
