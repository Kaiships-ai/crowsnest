import { eq } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { igClient } from "@/server/ig/client";
import { IgError } from "@/server/ig/errors";
import { clockNow } from "@/server/lib/clock";
import type { PullResult } from "@/server/lib/pull-result";
import type { PullItem, PullStop, PullSummary } from "@/server/services/connector-status";
import { runSync, type SyncResult } from "@/server/services/sync-engine";
import type { Connector, Sample } from "../types";
import { igSidecar } from "./manifest";

/** Maps a finished sync to a pull outcome by its job row. */
export function syncPull(r: SyncResult): PullResult<SyncResult, unknown> {
  const job = db.select({ status: tables.syncJobs.status, errorCode: tables.syncJobs.errorCode, errorMessage: tables.syncJobs.errorMessage }).from(tables.syncJobs).where(eq(tables.syncJobs.id, r.jobId)).get();
  if (job?.status === "success") return { kind: "complete", rows: r };
  if (job?.status === "partial") return { kind: "partial", rows: r, missing: r.gaps.map((g) => g.handle).join(", ") || "work left after a cancel", reason: r.gaps[0]?.error ?? "cancelled" };
  if (job?.errorCode === "IG_AUTH_REQUIRED") return { kind: "failed", reason: SESSION_EXPIRED };
  return { kind: "failed", reason: job?.errorMessage ?? `sync ${job?.status ?? "row missing"}` };
}

/** What a card pull did, for its summary, and when Instagram allows the next one. `null` is a run that threw. */
export function syncSummary(r: SyncResult | null, startedAt: Date, now: Date): { summary: Omit<PullSummary, "olderFrom">; retryAfter: string | null } {
  const durationSec = Math.round((now.getTime() - startedAt.getTime()) / 1000);
  const base = { durationSec, startedAt: startedAt.toISOString() };
  if (!r) return { summary: { ...base, total: 0, done: 0, updated: 0, newItems: 0, failed: 0, stop: null, items: [] }, retryAfter: null };
  const gapOf = new Map(r.gaps.map((g) => [g.handle, g]));
  const items: PullItem[] = r.handles.map((label, i) => {
    const gap = gapOf.get(label);
    if (gap) return { label, result: gap.code === "IG_RATE_LIMITED" ? "limited" : "failed" };
    return { label, result: i < r.dispatched ? "updated" : "not-pulled" };
  });
  const halt = r.gaps.find((g) => g.code === "IG_RATE_LIMITED") ?? r.gaps.find((g) => g.code === "IG_SERVICE_DOWN");
  const stop: PullStop | null =
    halt?.code === "IG_RATE_LIMITED" ? "limited" : halt ? "source-down" : r.stopReason === "cancelled" && r.dispatched < r.handles.length ? "stopped" : null;
  const retryAfter = halt?.retryAfterSec ? new Date(now.getTime() + halt.retryAfterSec * 1000).toISOString() : null;
  return {
    summary: { ...base, total: r.handles.length, done: r.dispatched, updated: r.channelsSynced, newItems: r.itemsCreated, failed: r.gaps.length, stop, items },
    retryAfter,
  };
}

export const SESSION_EXPIRED = "The session id expired. Sign in to instagram.com and copy a new session id.";

/** Instagram's wait as a time, from the sidecar's `retry_after_sec`. */
function retryAfterOf(err: unknown, now: Date): string | null {
  const sec = err instanceof IgError ? err.detail.retry_after_sec : undefined;
  return typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? new Date(now.getTime() + sec * 1000).toISOString() : null;
}

export function sampleFailure(err: unknown, now: Date): Sample {
  if (err instanceof IgError && err.code === "IG_RATE_LIMITED") return { ok: false, message: "Instagram is limiting requests.", retryAfter: retryAfterOf(err, now) };
  if (err instanceof IgError && err.code === "IG_AUTH_REQUIRED") return { ok: false, message: SESSION_EXPIRED, retryAfter: null };
  if (err instanceof IgError) return { ok: false, message: err.userMessage, retryAfter: null };
  return { ok: false, message: err instanceof Error ? err.message : String(err), retryAfter: null };
}

export const connector: Connector = {
  manifest: igSidecar,
  adapter: {
    async testConnection() {
      const health = await igClient.health();
      return health.loggedIn ? { ok: true, message: null } : { ok: false, message: health.canLogin ? "sidecar is logged out" : "no Instagram login saved" };
    },
    async sample() {
      try {
        const health = await igClient.health();
        if (!health.loggedIn || !health.username) return { ok: false, message: "The sidecar has no Instagram session yet. Enter a session id.", retryAfter: null };
        const profile = await igClient.profile(health.username);
        const count = (n: number | null) => (n === null ? "?" : n.toLocaleString("en-US"));
        return { ok: true, line: `${profile.handle} · ${count(profile.followerCount)} followers · ${count(profile.mediaCount)} posts` };
      } catch (err) {
        return sampleFailure(err, clockNow());
      }
    },
    async pull() {
      return syncPull(await runSync());
    },
  },
};
