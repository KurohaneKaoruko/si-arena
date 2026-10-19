import type { DeepReadonly } from "@si-arena/protocol";
import type { PaperState } from "../sdk";
import { PAPER_PALETTE } from "./palette";

export function paperPlayerSummaries(state: DeepReadonly<PaperState>) {
  return state.players.map((player) => ({
    id: player.id,
    label: `P${player.slot + 1}`,
    color: PAPER_PALETTE.players[player.slot]!,
    score: state.territory.filter((owner) => owner === player.slot).length,
    alive: player.alive,
  }));
}

/** Draw authoritative grid state; rendering never modifies or advances the rules. */
export function drawPaperBoard(
  context: CanvasRenderingContext2D,
  state: DeepReadonly<PaperState>,
  width: number,
  height: number,
): void {
  const cellWidth = width / state.width,
    cellHeight = height / state.height;
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
  for (const player of state.players) {
    if (!player.alive || !player.position) continue;
    const x = player.position.x * cellWidth,
      y = player.position.y * cellHeight;
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
  context.restore();
}
