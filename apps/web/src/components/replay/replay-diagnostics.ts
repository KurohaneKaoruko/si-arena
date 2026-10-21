/** Live dev sessions only: Memory committed around the executed input tick. */
export type MemoryLoader = (
  tick: number,
  playerId: string,
) => Promise<{ before: unknown; after: unknown } | undefined>;

/** Per-player record lookup that ignores inherited keys such as `constructor`. */
export function own<T>(map: Readonly<Record<string, T>> | undefined, id: string): T | undefined {
  return map && Object.hasOwn(map, id) ? map[id] : undefined;
}
