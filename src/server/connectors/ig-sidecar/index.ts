import { eq } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { igClient } from "@/server/ig/client";
import type { PullResult } from "@/server/lib/pull-result";
import { runSync, type SyncResult } from "@/server/services/sync-engine";
import type { Connector } from "../types";
import { igSidecar } from "./manifest";

/** Maps a finished sync to a pull outcome by its job row. */
export function syncPull(r: SyncResult): PullResult<SyncResult, unknown> {
  const job = db.select({ status: tables.syncJobs.status, errorCode: tables.syncJobs.errorCode, errorMessage: tables.syncJobs.errorMessage }).from(tables.syncJobs).where(eq(tables.syncJobs.id, r.jobId)).get();
  if (job?.status === "success") return { kind: "complete", rows: r };
  if (job?.status === "partial") return { kind: "partial", rows: r, missing: r.gaps.map((g) => g.handle).join(", ") || "work left after a cancel", reason: r.gaps[0]?.error ?? "cancelled" };
  if (job?.errorCode === "IG_AUTH_REQUIRED") return { kind: "failed", reason: "Instagram session expired. Sign in again: Edit key, then save a new Browser session id." };
  return { kind: "failed", reason: job?.errorMessage ?? `sync ${job?.status ?? "row missing"}` };
}

export const connector: Connector = {
  manifest: igSidecar,
  adapter: {
    async testConnection() {
      const health = await igClient.health();
      return health.loggedIn ? { ok: true, message: null } : { ok: false, message: health.canLogin ? "sidecar is logged out" : "no Instagram login saved" };
    },
    async pull() {
      return syncPull(await runSync());
    },
  },
};
