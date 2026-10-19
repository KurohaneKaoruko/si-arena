export interface ConcurrencyLimiter {
  acquire(): boolean;
  release(): void;
}

/** Rejects beyond the maximum instead of queueing; callers must release what they acquired. */
export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  let active = 0;
  return {
    acquire: () => {
      if (active >= maxConcurrent) return false;
      active += 1;
      return true;
    },
    release: () => {
      active = Math.max(0, active - 1);
    },
  };
}
