import { desc } from "drizzle-orm";
import { db, tables } from "@/server/db";

export type SyncStatusValue = "never" | "running" | "success" | "partial" | "failed";

/**
 * Latest sync_jobs row, mapped to the sidebar's status dot. Phase-1 seed writes zero
 * sync_jobs rows (the sync engine lands with phase 2A), so until integration this
 * always resolves to { status: "never", finishedAt: null } rather than `null` — the
 * `| null` in the return type is kept for API symmetry with the other query
 * functions, not because this implementation currently produces it.
 */
export async function getSyncStatus(): Promise<{ status: SyncStatusValue; finishedAt: string | null } | null> {
  const [row] = await db
    .select({ status: tables.syncJobs.status, finishedAt: tables.syncJobs.finishedAt })
    .from(tables.syncJobs)
    .orderBy(desc(tables.syncJobs.startedAt))
    .limit(1);

  if (!row) return { status: "never", finishedAt: null };
  return { status: row.status as SyncStatusValue, finishedAt: row.finishedAt };
}
