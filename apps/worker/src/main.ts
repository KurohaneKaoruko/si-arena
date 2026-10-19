import { SANDBOX_RUNTIME } from "@si-arena/sandbox";
import { createDatabase } from "@si-arena/db";
import { readWorkerConfig } from "./config";
import { claimNextMatch, failExpiredLeases } from "./claim";
import { runClaimedMatch, type WorkerJobContext } from "./execute";
import { claimableReleases } from "./games";
import { ReplayStore } from "./replay-store";

const POLL_INTERVAL_MS = 2_000;
const EXPIRE_SWEEP_INTERVAL_MS = 5_000;
const CLEANUP_INTERVAL_MS = 10 * 60_000;

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ service: "si-arena-worker", event, ...fields }));
}

async function main(): Promise<void> {
  const config = readWorkerConfig();
  const database = createDatabase(config.databaseUrl);
  const store = new ReplayStore(config.replaysDir);
  await store.prepare();
  const ctx: WorkerJobContext = {
    db: database.db,
    store,
    isolation: config.isolation,
  };
  const claimable = claimableReleases();
  const shutdown = new AbortController();
  const active = new Set<string>();
  const jobs = new Set<Promise<void>>();
  let stopped = false;
  let polling: Promise<void> | undefined;
  let lastSweepAt = 0;
  let lastCleanupAt = 0;

  const dispatch = async () => {
    const now = Date.now();
    if (now - lastSweepAt >= EXPIRE_SWEEP_INTERVAL_MS) {
      lastSweepAt = now;
      const failed = await failExpiredLeases(ctx.db).catch((error: unknown) => {
        log("expire-sweep-error", { message: String(error) });
        return 0;
      });
      if (failed > 0) log("leases-expired", { count: failed });
    }
    if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
      lastCleanupAt = now;
      const removed = await store.cleanup(ctx.db).catch((error: unknown) => {
        log("replay-cleanup-error", { message: String(error) });
        return { candidates: 0, finals: 0 };
      });
      if (removed.candidates > 0 || removed.finals > 0) {
        log("replays-cleaned", removed);
      }
    }
    while (active.size < config.concurrency) {
      if (stopped) break;
      const claim = await claimNextMatch(ctx.db, claimable).catch((error: unknown) => {
        log("claim-error", { message: String(error) });
        return null;
      });
      // A claim finishing during shutdown stays running for the lease sweep;
      // never start a new job after shutdown has begun.
      if (claim === null || stopped) break;
      active.add(claim.id);
      log("match-claimed", { matchId: claim.id, gameId: claim.gameId, release: claim.release });
      const job = runClaimedMatch(ctx, claim, shutdown.signal)
        .then(() => log("match-finished", { matchId: claim.id }))
        .catch((error: unknown) =>
          log("match-job-error", { matchId: claim.id, message: String(error) }),
        )
        .finally(() => {
          active.delete(claim.id);
          jobs.delete(job);
        });
      jobs.add(job);
    }
  };

  // One in-flight poll includes maintenance and claims. In particular, slow
  // claims must reserve capacity before another timer can inspect active.size.
  const poll = () => {
    if (stopped) return Promise.resolve();
    polling ??= dispatch().finally(() => {
      polling = undefined;
    });
    return polling;
  };
  const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  pollTimer.unref();

  let shuttingDown = false;
  const requestShutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopped = true;
    clearInterval(pollTimer);
    shutdown.abort();
    void (async () => {
      await polling;
      await Promise.allSettled(jobs);
      await database.close().catch(() => undefined);
      log("shutdown-complete", { pendingJobs: jobs.size });
    })();
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  await poll();
  if (stopped) return;

  log("started", {
    runtime: SANDBOX_RUNTIME,
    concurrency: config.concurrency,
    isolation: config.isolation.kind,
    replaysDir: config.replaysDir,
    games: claimable.map((release) => `${release.gameId}@${release.release}`),
  });
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ service: "si-arena-worker", event: "startup-error", message: String(error) }),
  );
  process.exitCode = 1;
});
