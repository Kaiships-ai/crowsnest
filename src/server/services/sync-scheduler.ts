import { desc } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { getSetting } from "@/server/settings";
import { LOCK_STALE_MS, runSync } from "./sync-engine";

/**
 * The in-process sync scheduler, modelled exactly on publish-scheduler.ts: one
 * setInterval in one process, a reentrancy guard, and a tick (runDueSync) that never
 * throws. Started once from server.ts. It exists to consume the syncCadenceMinutes
 * setting, which has always been stored but never read.
 *
 * The cadence clock is the newest sync_jobs row's startedAt, not a new table: any sync
 * (manual or scheduled) writes one, so a manual sync also defers the next scheduled one,
 * and the marker is durable across a restart for free (server.ts rebuilds the timer at
 * boot, but the "when did we last sync" answer lives in the database).
 */

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface SyncSchedulerDeps {
  /** The syncCadenceMinutes setting. 0 disables the scheduler. */
  cadenceMinutes: () => Promise<number>;
  /** The newest sync_jobs row, or null on a fresh install. */
  latestJob: () => Promise<{ status: string; startedAt: string } | null>;
  /** Starts a detached library sweep that skips channels synced within the window. */
  startSweep: (skipFreshWithinMinutes: number) => Promise<void>;
}

async function defaultLatestJob(): Promise<{ status: string; startedAt: string } | null> {
  const [row] = await db
    .select({ status: tables.syncJobs.status, startedAt: tables.syncJobs.startedAt })
    .from(tables.syncJobs)
    .orderBy(desc(tables.syncJobs.startedAt))
    .limit(1);
  return row ?? null;
}

// The scheduler starts a library sweep the same detached way startSyncAction does, but it
// is not a "use server" action and has no request scope, so it calls runSync directly and
// lets the returned promise run to completion. runSync writes its own terminal job row, so
// a rejection here only needs logging, not row bookkeeping.
async function defaultStartSweep(skipFreshWithinMinutes: number): Promise<void> {
  await runSync({ skipFreshWithinMinutes });
}

const DEFAULT_DEPS: SyncSchedulerDeps = {
  cadenceMinutes: () => getSetting("syncCadenceMinutes"),
  latestJob: defaultLatestJob,
  startSweep: defaultStartSweep,
};

export interface SyncTickResult {
  started: boolean;
  reason: "disabled" | "running" | "not_due" | "started";
}

/** One scheduler tick. Never throws. */
export async function runDueSync(now: Date = new Date(), deps: Partial<SyncSchedulerDeps> = {}): Promise<SyncTickResult> {
  const d: SyncSchedulerDeps = { ...DEFAULT_DEPS, ...deps };

  let cadence: number;
  let latest: { status: string; startedAt: string } | null;
  try {
    cadence = await d.cadenceMinutes();
    if (cadence <= 0) return { started: false, reason: "disabled" };
    latest = await d.latestJob();
  } catch (err) {
    log.error("sync_scheduler.read_state_failed", { error: errorMessage(err) });
    return { started: false, reason: "not_due" };
  }

  if (latest?.status === "running") {
    const runningForMs = now.getTime() - new Date(latest.startedAt).getTime();
    // A fresh "running" row is a sync actually in flight: respect it. A STALE one (older
    // than the reaper's own threshold) is a crash-stranded lock left by a hard process
    // kill — reapStaleLocks only ever runs inside acquireLock, which only runs when a
    // sync is attempted, so hard-skipping here forever would wedge the scheduler. Fall
    // through instead: acquireLock's reaper clears the stranded row, and if a sync is
    // genuinely still live (this row's staleness is a false read), acquireLock's
    // IMMEDIATE arbitration rejects the new attempt and the fire-and-forget .catch below
    // logs it — no crash, no double run.
    if (runningForMs < LOCK_STALE_MS) return { started: false, reason: "running" };
  } else if (latest) {
    const elapsedMs = now.getTime() - new Date(latest.startedAt).getTime();
    if (elapsedMs < cadence * 60_000) return { started: false, reason: "not_due" };
  }

  // Fire-and-forget: the sweep runs for minutes; a tick must not await it or the reentrancy
  // guard would hold `running` true for the whole sweep. startSweep's own errors are logged.
  d.startSweep(cadence).catch((err) => log.error("sync_scheduler.start_sweep_failed", { error: errorMessage(err) }));
  return { started: true, reason: "started" };
}

const DEFAULT_TICK_INTERVAL_MS = 60_000;
function resolveTickIntervalMs(): number {
  const raw = process.env.SYNC_SCHEDULER_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TICK_INTERVAL_MS;
}

/**
 * Starts the interval and returns a stop function. A `let running` reentrancy guard skips
 * a tick that would overlap one still in flight (a slow sweep-start check, or a sweep the
 * previous tick launched). Identical shape to startPublishScheduler. The 60s default tick
 * only checks whether the cadence has elapsed; it does not itself set the cadence.
 */
export function startSyncScheduler(deps: Partial<SyncSchedulerDeps> & { intervalMs?: number } = {}): () => void {
  const { intervalMs, ...schedulerDeps } = deps;
  const period = intervalMs ?? resolveTickIntervalMs();

  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDueSync(new Date(), schedulerDeps)
      .catch((err) => log.error("sync_scheduler.tick_rejected", { error: errorMessage(err) }))
      .finally(() => {
        running = false;
      });
  }, period);

  return () => clearInterval(timer);
}
