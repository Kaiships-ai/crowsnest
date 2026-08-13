import { desc, eq, or } from "drizzle-orm";
import { db, tables } from "@/server/db";

/**
 * The create-runs query layer (D1, create-run tracking). `create_runs` records one row
 * per "cook" attempt for a post — the studio's render pass, spawned as a detached child
 * process and tracked here the same way `sync_jobs` tracks a sync: a `running`/`waiting`
 * row that later lands on a terminal status.
 *
 * Plain module, not a "use server" file: `updateCreateRun` and `reconcileOrphanCreateRuns`
 * are internal helpers the ws layer and startup path call directly, and a "use server"
 * file may only export async server actions — see create-run-actions.ts for those.
 */

export type CreateRunStatus = "running" | "waiting" | "success" | "failed" | "canceled";

export type CreateRunSelect = typeof tables.createRuns.$inferSelect;

export function getCreateRun(id: string): CreateRunSelect | null {
  return db.select().from(tables.createRuns).where(eq(tables.createRuns.id, id)).get() ?? null;
}

/** The most recent create run for a post, by startedAt — what the studio reattaches to
 *  on reload, and what a post detail screen shows as "last cook" between runs. */
export function getLatestCreateRunForPost(postId: string): CreateRunSelect | null {
  return (
    db
      .select()
      .from(tables.createRuns)
      .where(eq(tables.createRuns.postId, postId))
      .orderBy(desc(tables.createRuns.startedAt))
      .limit(1)
      .get() ?? null
  );
}

/** Internal write path: the ws layer calls this as a cook progresses (heartbeat, pid,
 *  status transitions) and on completion (status, finishedAt, renderAssetId or
 *  errorMessage). Not a server action — see the file header. */
export function updateCreateRun(
  id: string,
  patch: Partial<{
    status: CreateRunStatus;
    finishedAt: string;
    heartbeatAt: string;
    renderAssetId: string;
    errorMessage: string;
    pid: number;
  }>
): void {
  db.update(tables.createRuns).set(patch).where(eq(tables.createRuns.id, id)).run();
}

const ORPHAN_REASON = "stopped, server restarted";

function pidAlive(pid: number): boolean {
  try {
    // Sends no signal, only probes for existence/permission — same pattern as
    // sidecarPidAlive (src/server/sidecar/control.ts) and routerPidAlive.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Marks any `running`/`waiting` create run whose process is gone as `failed`. Meant to
 * run once at server startup: a cook's pid dies with the server process that spawned
 * it, so a row still claiming `running` after a restart is not a run in progress, it is
 * a stale row nothing will ever finish. Returns how many rows it changed.
 */
export function reconcileOrphanCreateRuns(now: number = Date.now()): number {
  const rows = db
    .select()
    .from(tables.createRuns)
    .where(or(eq(tables.createRuns.status, "running"), eq(tables.createRuns.status, "waiting")))
    .all();

  let changed = 0;
  for (const row of rows) {
    if (row.pid != null && pidAlive(row.pid)) continue;
    db.update(tables.createRuns)
      .set({ status: "failed", errorMessage: ORPHAN_REASON, finishedAt: new Date(now).toISOString() })
      .where(eq(tables.createRuns.id, row.id))
      .run();
    changed++;
  }
  return changed;
}
