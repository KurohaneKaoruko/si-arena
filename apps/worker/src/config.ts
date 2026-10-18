export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  const concurrency = Number(env.WORKER_CONCURRENCY ?? 2);
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("WORKER_CONCURRENCY must be a positive integer");
  }
  return { concurrency };
}
