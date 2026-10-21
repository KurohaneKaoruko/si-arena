/**
 * Cells a closer encloses: everything its own territory and trail cut off from the map edge,
 * found by one flood fill from every unblocked edge cell. Returns 1 for enclosed cells.
 */
export function enclosedCells(
  width: number,
  height: number,
  territory: readonly number[],
  trails: readonly number[],
  slot: number,
): Uint8Array {
  const outside = new Uint8Array(territory.length);
  const queue = new Int32Array(territory.length);
  let length = 0;
  const visit = (index: number) => {
    if (!outside[index] && territory[index] !== slot && trails[index] !== slot) {
      outside[index] = 1;
      queue[length++] = index;
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
  for (let cursor = 0; cursor < length; cursor++) {
    const index = queue[cursor]!;
    const x = index % width;
    if (index >= width) visit(index - width);
    if (x + 1 < width) visit(index + 1);
    if (index + width < territory.length) visit(index + width);
    if (x > 0) visit(index - 1);
  }
  for (let index = 0; index < outside.length; index++) outside[index] = outside[index] ? 0 : 1;
  return outside;
}
