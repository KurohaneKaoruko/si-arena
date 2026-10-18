import type { DeepReadonly } from "@si-arena/protocol";
import type { PaperState } from "../sdk";

/** Flood fill from every unblocked edge; both players use the same pre-capture territory. */
export function captureCells(state: DeepReadonly<PaperState>, slot: 0 | 1): Set<number> {
  const { width, height, territory, trails } = state;
  const outside = new Uint8Array(territory.length);
  const queue: number[] = [];
  const visit = (index: number) => {
    if (!outside[index] && territory[index] !== slot && trails[index] !== slot) {
      outside[index] = 1;
      queue.push(index);
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor];
    if (index === undefined) throw new Error("Flood-fill queue is invalid");
    const x = index % width;
    const y = Math.floor(index / width);
    // This order is part of the deterministic traversal contract.
    if (y > 0) visit(index - width);
    if (x + 1 < width) visit(index + 1);
    if (y + 1 < height) visit(index + width);
    if (x > 0) visit(index - 1);
  }
  const captured = new Set<number>();
  for (let index = 0; index < territory.length; index++) if (!outside[index]) captured.add(index);
  return captured;
}
