"use client";

/**
 * The Sync section (design brief §5/§6). What used to live here was a preview of the
 * "provider chain": which of two vendor scrapers would run next, derived from which env
 * keys happened to be set. There is no chain any more: one source (the instagrapi
 * sidecar), and its configuration is validated at boot by `src/server/config.ts`. So this
 * section shows the sync parameters actually in effect, plus what the last run did.
 *
 * It became a client component for one reason: it was rendering the last job's counters
 * as static server-rendered text, so a sync started from anywhere left this page frozen
 * on the *previous* run until a manual reload. It is now the monitoring surface: full
 * live panel while a run is in flight, the server-rendered summary the rest of the time.
 * Every prop it takes is still plain serializable data read on the server, except
 * `settings`, whose three fields are now editable app_settings rows (see below).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { SyncProgressPanel } from "@/components/sync/sync-progress-panel";
import { syncViewState } from "@/components/sync/sync-progress-view";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { Button } from "@/components/ui/button";
import { NumberField, SettingRow } from "./setting-field";
import { updateAppSettingsAction } from "@/server/actions/settings-actions";
import type { AppSettingsView } from "@/server/settings";

export interface SyncConfigSummary {
  maxItemsPerSync: number;
  eagerVideoDownload: boolean;
  mediaRoot: string;
}

/** The three `app_settings` keys this section now edits, matching Wave 1's contract
 *  (`src/server/settings/index.ts`) exactly: `syncLookbackDays` is read by `runSync`,
 *  `syncCadenceMinutes` and `mediaRetentionDays` are stored and DB-overridable but have
 *  no scheduler and no reaper behind them yet.
 *
 *  These three used to render as static config-derived text ("30 days", "manual only",
 *  "nothing is deleted") with no write path: hand-editing `.env.local` and restarting
 *  was the only way to change them. Wave 1 gave every one of them a real database row
 *  and a source ("db" | "env" | "default"); this section is the edit surface for that
 *  row. The two unwired keys keep their honest warning (a user who reads "90 days" next
 *  to "asset retention" must not conclude disk use is bounded), it just now sits next to
 *  an input instead of standing in for one. */
type SyncSettings = Pick<AppSettingsView, "syncLookbackDays" | "syncCadenceMinutes" | "mediaRetentionDays">;

const ENV_VAR_NAME: Record<keyof SyncSettings, string> = {
  syncLookbackDays: "LOOKBACK_DAYS",
  syncCadenceMinutes: "SYNC_INTERVAL_MINUTES",
  mediaRetentionDays: "MEDIA_RETENTION_DAYS",
};

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
      <div data-num className={`text-sm ${bad && value > 0 ? "text-destructive" : ""}`}>
        {value}
      </div>
      <div data-lab className="font-mono text-2xs text-faint">
        {label}
      </div>
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
        No sync has run yet. There is no <code>sync_jobs</code> row to report.
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
          {job.errorMessage ? `: ${job.errorMessage}` : ""}
        </p>
      )}
    </div>
  );
}

export function SyncSection({
  config,
  settings,
  lastJob,
}: {
  config: SyncConfigSummary;
  settings: SyncSettings;
  lastJob: LastSyncJobResult;
}) {
  const router = useRouter();
  const { progress, isRunning, stalled, error, start, cancel } = useSyncProgress();
  const [starting, setStarting] = useState(false);

  const [lookback, setLookback] = useState(String(settings.syncLookbackDays.value));
  const [cadence, setCadence] = useState(String(settings.syncCadenceMinutes.value));
  const [retention, setRetention] = useState(String(settings.mediaRetentionDays.value));
  const [savingSettings, setSavingSettings] = useState(false);

  const settingsDirty =
    lookback !== String(settings.syncLookbackDays.value) ||
    cadence !== String(settings.syncCadenceMinutes.value) ||
    retention !== String(settings.mediaRetentionDays.value);

  async function saveSyncSettings() {
    setSavingSettings(true);
    const result = await updateAppSettingsAction({
      syncLookbackDays: Number(lookback),
      syncCadenceMinutes: Number(cadence),
      mediaRetentionDays: Number(retention),
    });
    setSavingSettings(false);
    if (result.ok) {
      toast.success("Sync settings saved");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  /** `infoNote` for a key currently resolved from its env var: the one case the brief
   *  requires this section say plainly where a shown value came from. A "db" or
   *  "default" source gets no note: a value the user already saved needs no
   *  explanation, and the built-in default is not worth calling out on every load. */
  function envNote(key: keyof SyncSettings): string | undefined {
    return settings[key].source === "env"
      ? `Currently read from ${ENV_VAR_NAME[key]}. Save below to store an override in the database.`
      : undefined;
  }

  const state = syncViewState(progress, stalled);
  const live = state === "running" || state === "cancelling" || state === "stalled";
  // Gaps outlive the run that produced them and are the whole point of this pass: a
  // partial run must still be able to say which channels it left behind, and offer to
  // retry exactly those. `lastJob` cannot show them: it carries no gap list.
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
        <h2 className="text-lg font-semibold">Sync</h2>
        <p className="text-sm text-muted-foreground">
          The three rows just below are still <code>.env.local</code>-only, validated at boot. A bad value there stops the app starting
          rather than surfacing later as an empty sync. Lookback, cadence, and retention underneath those are stored in the database and
          editable here.
        </p>
      </div>

      <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-1.5 border border-border p-4 text-sm">
        <ConfigRow label="Per-sync cap" value={`${config.maxItemsPerSync} posts`} note="MAX_ITEMS_PER_SYNC" />
        <ConfigRow
          label="Video download"
          value={config.eagerVideoDownload ? "eager" : "on demand"}
          note={
            config.eagerVideoDownload
              ? "EAGER_VIDEO_DOWNLOAD=true: every video pulled during sync"
              : "EAGER_VIDEO_DOWNLOAD=false: pulled on first play"
          }
        />
        <ConfigRow label="Media root" value={config.mediaRoot} note="MEDIA_ROOT" />
      </dl>

      <div className="flex flex-col gap-2">
        <SettingRow label="Lookback window" hint="How far back a sync looks by default." infoNote={envNote("syncLookbackDays")}>
          <NumberField value={lookback} onChange={setLookback} min={1} max={3650} suffix="days" ariaLabel="Sync lookback window" />
        </SettingRow>
        <SettingRow
          label="Sync cadence"
          hint="Minutes between automatic syncs."
          warnNote="No scheduler exists. A sync only ever starts from a click, so this number has no effect yet; it is stored for the day one does."
          infoNote={envNote("syncCadenceMinutes")}
        >
          <NumberField value={cadence} onChange={setCadence} min={0} max={10_080} suffix="min" ariaLabel="Sync cadence" />
        </SettingRow>
        <SettingRow
          label="Asset retention"
          hint="Days of downloaded media to keep."
          warnNote="No reaper reads this. Disk use is unbounded regardless of this number."
          infoNote={envNote("mediaRetentionDays")}
        >
          <NumberField value={retention} onChange={setRetention} min={1} max={3650} suffix="days" ariaLabel="Media retention" />
        </SettingRow>
        <Button onClick={saveSyncSettings} disabled={!settingsDirty || savingSettings} className="w-fit" size="sm" variant="outline">
          {savingSettings ? "Saving…" : "Save"}
        </Button>
      </div>

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
