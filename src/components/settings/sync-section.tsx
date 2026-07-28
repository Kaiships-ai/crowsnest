"use client";

/**
 * The Sync section (design brief §5/§6). What used to live here was a preview of the
 * "provider chain" — which of two vendor scrapers would run next, derived from which env
 * keys happened to be set. There is no chain any more: one source (the instagrapi
 * sidecar), and its configuration is validated at boot by `src/server/config.ts`. So this
 * section shows the sync parameters actually in effect, plus what the last run did.
 *
 * It became a client component for one reason: it was rendering the last job's counters
 * as static server-rendered text, so a sync started from anywhere left this page frozen
 * on the *previous* run until a manual reload. It is now the monitoring surface — full
 * live panel while a run is in flight, the server-rendered summary the rest of the time.
 * Every prop it takes is still plain serializable data read on the server.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SyncProgressPanel } from "@/components/sync/sync-progress-panel";
import { syncViewState } from "@/components/sync/sync-progress-view";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { Button } from "@/components/ui/button";

export interface SyncConfigSummary {
  lookbackDays: number;
  maxItemsPerSync: number;
  eagerVideoDownload: boolean;
  mediaRoot: string;
  /** Validated at boot and otherwise inert — see the "Inert settings" note below. */
  mediaRetentionDays: number;
  /** Validated at boot and otherwise inert — see the "Inert settings" note below. */
  syncIntervalMinutes: number;
}

/**
 * Inert settings.
 *
 * MEDIA_RETENTION_DAYS and SYNC_INTERVAL_MINUTES are parsed and range-checked by
 * config.ts, and that is the entire extent of their existence. Grep the tree: nothing
 * reads either one. There is no retention reaper — `media_assets.last_verified_at` is
 * written once at insert (server/ig/assets.ts) and never read again — and there is no
 * scheduler; every run in this app starts from a click.
 *
 * So these two rows used to render "90 days" and "every 60 min" as though they were
 * active policy. A user who reads "asset retention 90 days" concludes disk use is
 * bounded, turns on EAGER_VIDEO_DOWNLOAD against a prolific channel, and fills the disk.
 * That is the same class of lie as the old indeterminate sync spinner, so it gets the
 * same treatment: the setting and its value are still shown, because they are real
 * config, but the row states plainly that nothing consumes them.
 *
 * If you are here to "fix" this by restoring the friendly wording: implement the reaper
 * and the scheduler first, then delete this comment.
 */

/** The `sync_jobs` columns this section renders. Structural on purpose: it depends on the
 *  shape of the row, not on the sync engine's module surface. */
export interface LastSyncJob {
  startedAt: string;
  finishedAt: string | null;
  status: string;
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsFailed: number;
  itemsDeleted: number;
  assetsDownloaded: number;
  assetsFailed: number;
  stopReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const STOP_REASON_LABEL: Record<string, string> = {
  lookback: "stopped at the lookback boundary",
  cap: "stopped at the per-sync cap",
  exhausted: "ran out of posts",
  error: "stopped on an error",
  cancelled: "was cancelled",
};

/** `warn` is for a row whose setting is accepted but does nothing. The note has to carry
 *  visual weight there, because the failure mode is a reader skimming past it and
 *  believing the app enforces something it does not. */
function ConfigRow({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <span className={warn ? "font-mono text-destructive" : "font-mono"}>{value}</span>
        {note && <span className={`ml-2 text-xs ${warn ? "text-destructive/90" : "text-muted-foreground"}`}>{note}</span>}
      </dd>
    </>
  );
}

function Counter({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className={`font-mono text-sm ${bad && value > 0 ? "text-destructive" : ""}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** `{ok:false}` is a real, rendered state: a `sync_jobs` read that *failed* is not the
 *  same thing as "no sync has run yet", and must not be shown as one. */
export type LastSyncJobResult = { ok: true; job: LastSyncJob | null } | { ok: false; error: string };

function LastJobSummary({ lastJob }: { lastJob: LastSyncJobResult }) {
  if (!lastJob.ok) {
    return <p className="mt-1 text-sm text-destructive">Couldn&apos;t read the sync history: {lastJob.error}</p>;
  }
  if (lastJob.job === null) {
    return (
      <p className="mt-1 text-sm text-muted-foreground">
        No sync has run yet — there is no <code>sync_jobs</code> row to report.
      </p>
    );
  }
  const job = lastJob.job;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{job.status}</span> · started {job.startedAt}
        {job.finishedAt ? ` · finished ${job.finishedAt}` : " · still running"}
        {job.stopReason ? ` · ${STOP_REASON_LABEL[job.stopReason] ?? job.stopReason}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Counter label="seen" value={job.itemsSeen} />
        <Counter label="created" value={job.itemsCreated} />
        <Counter label="updated" value={job.itemsUpdated} />
        <Counter label="failed" value={job.itemsFailed} bad />
        <Counter label="deleted" value={job.itemsDeleted} />
        <Counter label="assets saved" value={job.assetsDownloaded} />
        <Counter label="assets failed" value={job.assetsFailed} bad />
      </div>
      {job.errorCode && (
        <p className="text-xs text-destructive">
          <span className="font-mono">{job.errorCode}</span>
          {job.errorMessage ? ` — ${job.errorMessage}` : ""}
        </p>
      )}
    </div>
  );
}

export function SyncSection({ config, lastJob }: { config: SyncConfigSummary; lastJob: LastSyncJobResult }) {
  const router = useRouter();
  const { progress, isRunning, stalled, error, start, cancel } = useSyncProgress();
  const [starting, setStarting] = useState(false);

  const state = syncViewState(progress, stalled);
  const live = state === "running" || state === "cancelling" || state === "stalled";
  // Gaps outlive the run that produced them and are the whole point of this pass: a
  // partial run must still be able to say which channels it left behind, and offer to
  // retry exactly those. `lastJob` cannot show them — it carries no gap list.
  const showPanel = live || (progress !== null && progress.gaps.length > 0);

  async function syncNow() {
    setStarting(true);
    try {
      await start();
    } finally {
      setStarting(false);
    }
  }

  // `lastJob` is server-rendered, so once a run this page watched reaches a terminal row
  // the summary below is stale by exactly one sync. Refetching the route's server data is
  // the only way to correct it without duplicating the query client-side.
  const watchedJobRef = useRef<string | null>(null);
  const refreshedJobRef = useRef<string | null>(null);
  useEffect(() => {
    if (progress === null) return;
    if (progress.status === "running") {
      watchedJobRef.current = progress.jobId;
      return;
    }
    if (progress.jobId !== watchedJobRef.current || refreshedJobRef.current === progress.jobId) return;
    refreshedJobRef.current = progress.jobId;
    router.refresh();
  }, [progress, router]);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Sync</h2>
        <p className="text-sm text-muted-foreground">
          Set in <code>.env.local</code> and validated at boot — a bad value stops the app starting rather than surfacing later as an empty
          sync.
        </p>
      </div>

      <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border p-4 text-sm">
        <ConfigRow label="Lookback window" value={`${config.lookbackDays} days`} note="LOOKBACK_DAYS" />
        <ConfigRow label="Per-sync cap" value={`${config.maxItemsPerSync} posts`} note="MAX_ITEMS_PER_SYNC" />
        <ConfigRow
          label="Video download"
          value={config.eagerVideoDownload ? "eager" : "on demand"}
          note={
            config.eagerVideoDownload
              ? "EAGER_VIDEO_DOWNLOAD=true — every video pulled during sync"
              : "EAGER_VIDEO_DOWNLOAD=false — pulled on first play"
          }
        />
        <ConfigRow label="Media root" value={config.mediaRoot} note="MEDIA_ROOT" />
        <ConfigRow
          label="Asset retention"
          value="nothing is deleted"
          note={`MEDIA_RETENTION_DAYS=${config.mediaRetentionDays} is validated at boot, but no reaper reads it — disk use is unbounded`}
          warn
        />
        <ConfigRow
          label="Schedule"
          // Always "manual only": there is no scheduler, so a non-zero interval is not a
          // schedule this app will honour — it is a setting silently doing nothing.
          value="manual only"
          note={
            config.syncIntervalMinutes > 0
              ? `SYNC_INTERVAL_MINUTES=${config.syncIntervalMinutes} has no effect — there is no scheduler; a sync only ever starts from a click`
              : "SYNC_INTERVAL_MINUTES — no scheduler exists; a sync only ever starts from a click"
          }
          warn={config.syncIntervalMinutes > 0}
        />
      </dl>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{live ? "Sync in progress" : "Last sync"}</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={syncNow}
            // A stalled run is a dead process holding the lock; starting a new sync takes
            // the lock back, so the button must stay live in that state.
            disabled={starting || (isRunning && !stalled)}
          >
            {starting || (isRunning && !stalled) ? "Syncing…" : "Sync now"}
          </Button>
        </div>

        {showPanel ? (
          <div className="mt-2">
            <SyncProgressPanel
              progress={progress}
              stalled={stalled}
              pollError={error}
              onCancel={() => void cancel()}
              onRetry={(channelIds) => void start(channelIds)}
            />
          </div>
        ) : (
          <>
            <LastJobSummary lastJob={lastJob} />
            {error !== null && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </>
        )}
      </div>
    </section>
  );
}
