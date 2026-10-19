export interface LogLimits {
  lineBytes: number;
  tickLines: number;
  tickBytes: number;
  matchBytes: number;
}

export interface ResourceLimits {
  codeBytes: number;
  heapBytes: number;
  stackBytes: number;
  cpuMs: number;
  wallMs: number;
  memoryBytes: number;
  actionBytes: number;
  observationBytes: number;
  resultBytes: number;
  ipcBytes: number;
  errorBytes: number;
  processMemoryBytes: number;
  startupMs: number;
  logs: LogLimits;
}

export type ResourceLimitOverrides = Partial<Omit<ResourceLimits, "logs">> & {
  logs?: Partial<LogLimits>;
};

const KiB = 1024;
const MiB = 1024 * KiB;

export const DEFAULT_RESOURCE_LIMITS: Readonly<ResourceLimits> = Object.freeze({
  codeBytes: 256 * KiB,
  heapBytes: 32 * MiB,
  stackBytes: 256 * KiB,
  cpuMs: 20,
  wallMs: 500,
  memoryBytes: 64 * KiB,
  actionBytes: KiB,
  observationBytes: 128 * KiB,
  resultBytes: 96 * KiB,
  ipcBytes: MiB,
  errorBytes: 4 * KiB,
  processMemoryBytes: 256 * MiB,
  startupMs: 5000,
  logs: Object.freeze({ lineBytes: 2 * KiB, tickLines: 32, tickBytes: 8 * KiB, matchBytes: MiB }),
});

/** Resolve only configuration authored by trusted game packages. */
export function resolveResourceLimits(overrides: ResourceLimitOverrides = {}): ResourceLimits {
  assertRecord("limits", overrides);
  const limits = { ...DEFAULT_RESOURCE_LIMITS, logs: { ...DEFAULT_RESOURCE_LIMITS.logs } };
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(DEFAULT_RESOURCE_LIMITS, key)) {
      throw new TypeError(`Unknown resource limit: ${key}`);
    }
    if (key === "logs") continue;
    const resourceKey = key as keyof Omit<ResourceLimits, "logs">;
    const value = overrides[resourceKey];
    if (value !== undefined) limits[resourceKey] = value;
  }
  if (overrides.logs !== undefined) {
    assertRecord("logs", overrides.logs);
    for (const key of Object.keys(overrides.logs)) {
      if (!Object.hasOwn(DEFAULT_RESOURCE_LIMITS.logs, key)) {
        throw new TypeError(`Unknown log limit: ${key}`);
      }
      const logKey = key as keyof LogLimits;
      const value = overrides.logs[logKey];
      if (value !== undefined) limits.logs[logKey] = value;
    }
  }
  for (const [key, value] of Object.entries(limits)) {
    if (key !== "logs") assertPositiveInteger(key, value);
  }
  for (const [key, value] of Object.entries(limits.logs))
    assertPositiveInteger(`logs.${key}`, value);
  if (limits.wallMs < limits.cpuMs) throw new RangeError("wallMs must cover cpuMs");
  if (limits.errorBytes < 128)
    throw new RangeError("errorBytes must fit a diagnostic envelope (at least 128 bytes)");
  if (limits.stackBytes >= limits.heapBytes)
    throw new RangeError("stackBytes must be below heapBytes");
  if (limits.memoryBytes >= limits.heapBytes)
    throw new RangeError("memoryBytes must be below heapBytes");
  if (limits.processMemoryBytes < limits.heapBytes + 128 * MiB) {
    throw new RangeError("processMemoryBytes must reserve 128MiB beyond heapBytes");
  }
  if (
    limits.logs.lineBytes > limits.logs.tickBytes ||
    limits.logs.tickBytes > limits.logs.matchBytes
  ) {
    throw new RangeError("Log byte budgets must fit within their containing budgets");
  }
  if (limits.resultBytes < limits.memoryBytes + limits.actionBytes + limits.errorBytes + 4 * KiB) {
    throw new RangeError("resultBytes must cover Memory, action, diagnostics, and framing");
  }
  if (
    limits.ipcBytes < limits.resultBytes ||
    limits.ipcBytes < limits.codeBytes + limits.observationBytes + limits.memoryBytes + 16 * KiB
  ) {
    throw new RangeError("ipcBytes must cover input and output payloads");
  }
  return limits;
}

function assertPositiveInteger(key: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${key} must be a positive safe integer`);
  }
}

function assertRecord(key: string, value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${key} must be an object`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${key} must be a plain object`);
  }
}
