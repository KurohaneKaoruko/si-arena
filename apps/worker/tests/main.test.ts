import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Job = { id: string; gameId: string; release: string };

const mocks = vi.hoisted(() => ({
  claim: vi.fn<() => Promise<Job | null>>(),
  run: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
  sweep: vi.fn<() => Promise<number>>(),
  prepare: vi.fn<() => Promise<void>>(),
  cleanup: vi.fn<() => Promise<{ candidates: number; finals: number }>>(),
}));

vi.mock("@si-arena/sandbox", () => ({ SANDBOX_RUNTIME: "test" }));
vi.mock("@si-arena/db", () => ({ createDatabase: () => ({ db: {}, close: mocks.close }) }));
vi.mock("../src/config", () => ({
  readWorkerConfig: () => ({
    databaseUrl: "test",
    concurrency: 1,
    replaysDir: "test",
    isolation: { kind: "local" },
  }),
}));
vi.mock("../src/claim", () => ({ claimNextMatch: mocks.claim, failExpiredLeases: mocks.sweep }));
vi.mock("../src/execute", () => ({ runClaimedMatch: mocks.run }));
vi.mock("../src/games", () => ({
  claimableReleases: () => [{ gameId: "paper", release: "paper@0.0.0" }],
}));
vi.mock("../src/replay-store", () => ({
  ReplayStore: class {
    prepare = mocks.prepare;
    cleanup = mocks.cleanup;
  },
}));

let stop: (() => void) | undefined;
let finishPending: Array<() => void>;

function pending<T>(cleanupValue: T) {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  finishPending.push(() => resolve(cleanupValue));
  return { promise, resolve };
}

function job(id: string): Job {
  return { id, gameId: "paper", release: "paper@0.0.0" };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  finishPending = [];
  stop = undefined;
  mocks.claim.mockResolvedValue(null);
  mocks.run.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.sweep.mockResolvedValue(0);
  mocks.prepare.mockResolvedValue(undefined);
  mocks.cleanup.mockResolvedValue({ candidates: 0, finals: 0 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  const once = process.once.bind(process);
  vi.spyOn(process, "once").mockImplementation((event, listener) => {
    if (event === "SIGINT" || event === "SIGTERM") {
      if (event === "SIGTERM") stop = () => listener();
      return process;
    }
    return once(event, listener);
  });
});

afterEach(async () => {
  stop?.();
  for (const finish of finishPending) finish();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
});

test("slow claims across timer intervals cannot exceed the configured job capacity", async () => {
  const claim = pending<Job | null>(null);
  const firstRun = pending<void>(undefined);
  const secondRun = pending<void>(undefined);
  mocks.claim.mockReturnValueOnce(claim.promise).mockResolvedValueOnce(job("second"));
  mocks.run.mockReturnValueOnce(firstRun.promise).mockReturnValueOnce(secondRun.promise);
  await import("../src/main");
  await vi.advanceTimersByTimeAsync(6_000);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  expect(mocks.run).not.toHaveBeenCalled();

  claim.resolve(job("first"));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(6_000);
  expect(mocks.claim).toHaveBeenCalledTimes(1);

  firstRun.resolve();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.claim).toHaveBeenCalledTimes(2);
  expect(mocks.run).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(6_000);
  expect(mocks.claim).toHaveBeenCalledTimes(2);
});

test("shutdown drains a pending claim without starting its job or closing the pool early", async () => {
  const claim = pending<Job | null>(null);
  mocks.claim.mockReturnValueOnce(claim.promise);
  await import("../src/main");
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  expect(stop).toBeDefined();
  stop!();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.close).not.toHaveBeenCalled();

  claim.resolve(job("late"));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(6_000);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
});

test("a failed claim does not prevent a later poll from filling capacity", async () => {
  const run = pending<void>(undefined);
  mocks.claim
    .mockRejectedValueOnce(new Error("database unavailable"))
    .mockResolvedValueOnce(job("retry"));
  mocks.run.mockReturnValueOnce(run.promise);
  await import("../src/main");
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  expect(mocks.run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.claim).toHaveBeenCalledTimes(2);
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
