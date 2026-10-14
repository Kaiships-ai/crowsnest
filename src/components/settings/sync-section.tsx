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
 * `settings`, whose four fields are now editable app_settings rows (see below).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { SyncProgressPanel } from "@/components/sync/sync-progress-panel";
import { syncViewState } from "@/components/sync/sync-progress-view";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { NumberField, SettingRow } from "./setting-field";
import { numberFieldError } from "./number-validation";
import { updateAppSettingsAction } from "@/server/actions/settings-actions";
import { startViewCountBackfillAction } from "@/server/actions/sync-actions";
import type { AppSettingsView } from "@/server/settings";

export interface SyncConfigSummary {
  eagerVideoDownload: boolean;
  mediaRoot: string;
}

/** The four `app_settings` keys this section now edits, matching Wave 1's contract
 *  (`src/server/settings/index.ts`) exactly: `syncLookbackDays`, `maxItemsPerSync`, and
 *  `syncCadenceMinutes` are all read (by `runSync`, and by `sync-scheduler.ts`
 *  respectively); `mediaRetentionDays` is stored and DB-overridable but has no reaper
 *  behind it yet.
 *
 *  These four used to render as static config-derived text ("30 days", "200 posts",
 *  "manual only", "nothing is deleted") with no write path: hand-editing `.env.local`
 *  and restarting was the only way to change them. Wave 1 gave every one of them a real
 *  database row and a source ("db" | "env" | "default"); this section is the edit
 *  surface for that row. `maxItemsPerSync` was the last of the four still stuck in the
 *  read-only config table below (a leftover from before it had a database row); it
 *  belongs here, next to lookback, because both bound the same sync run and both are
 *  now equally editable. The one genuinely unwired key keeps its honest warning (a
 *  user who reads "90 days" next to "asset retention" must not conclude disk use is
 *  bounded), it just now sits next to an input instead of standing in for one. */
type SyncSettings = Pick<
  AppSettingsView,
  "syncLookbackDays" | "maxItemsPerSync" | "viewCountEnrichPerChannel" | "syncCadenceMinutes" | "mediaRetentionDays"
>;

const ENV_VAR_NAME: Record<keyof SyncSettings, string> = {
  syncLookbackDays: "LOOKBACK_DAYS",
  maxItemsPerSync: "MAX_ITEMS_PER_SYNC",
  viewCountEnrichPerChannel: "VIEW_COUNT_ENRICH_PER_CHANNEL",
  syncCadenceMinutes: "SYNC_INTERVAL_MINUTES",
  mediaRetentionDays: "MEDIA_RETENTION_DAYS",
};

/** The inline recommendation for the enrichment count, phrased against whichever baseline
 *  window is actually configured.
 *
 *  Measuring fewer posts than the baseline scores against fixes the number the feed prints
 *  without producing a score to go with it, which is the trap this note exists to keep a
 *  user out of. Only "last12Posts" has a fixed post count; the other two windows are
 *  described honestly rather than given an invented figure. */
function enrichRecommendation(window: AppSettingsView["scoreBaselineWindow"]["value"]): string {
  if (window === "last12Posts") return "Recommended: at least 12, the number of posts your baseline scores against.";
  if (window === "last30Days") return "Recommended: enough to cover 30 days of posting, since that is the window your baseline scores against.";
  return "Recommended: as high as your request budget allows. Your baseline scores against all history.";
}

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
    <TableRow>
      <TableCell className="w-[12rem] align-top text-muted-foreground">{label}</TableCell>
      <TableCell className="align-top">
        <span className={warn ? "font-mono text-destructive" : "font-mono"}>{value}</span>
        {note && <span className={`ml-2 text-xs ${warn ? "text-destructive/90" : "text-muted-foreground"}`}>{note}</span>}
      </TableCell>
    </TableRow>
  );
}

function Counter({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <Item variant="outline" size="xs">
      <ItemContent>
        <ItemTitle data-num className={bad && value > 0 ? "text-destructive" : undefined}>
          {value}
        </ItemTitle>
        <ItemDescription data-lab className="font-mono text-2xs">
          {label}
        </ItemDescription>
      </ItemContent>
    </Item>
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
      <ItemGroup className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Counter label="seen" value={job.itemsSeen} />
        <Counter label="created" value={job.itemsCreated} />
        <Counter label="updated" value={job.itemsUpdated} />
        <Counter label="failed" value={job.itemsFailed} bad />
        <Counter label="deleted" value={job.itemsDeleted} />
        <Counter label="assets saved" value={job.assetsDownloaded} />
        <Counter label="assets failed" value={job.assetsFailed} bad />
      </ItemGroup>
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
  scoreBaselineWindow,
  lastJob,
}: {
  config: SyncConfigSummary;
  settings: SyncSettings;
  /** Read only to phrase the enrichment recommendation. Scoring itself is edited in its
   *  own section; this section never writes it. */
  scoreBaselineWindow: AppSettingsView["scoreBaselineWindow"]["value"];
  lastJob: LastSyncJobResult;
}) {
  const router = useRouter();
  const { progress, isRunning, stalled, error, start, cancel } = useSyncProgress();
  const [starting, setStarting] = useState(false);

  const [lookback, setLookback] = useState(String(settings.syncLookbackDays.value));
  const [maxItems, setMaxItems] = useState(String(settings.maxItemsPerSync.value));
  const [enrichPerChannel, setEnrichPerChannel] = useState(String(settings.viewCountEnrichPerChannel.value));
  const [cadence, setCadence] = useState(String(settings.syncCadenceMinutes.value));
  const [retention, setRetention] = useState(String(settings.mediaRetentionDays.value));
  const [savingSettings, setSavingSettings] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const settingsDirty =
    lookback !== String(settings.syncLookbackDays.value) ||
    maxItems !== String(settings.maxItemsPerSync.value) ||
    enrichPerChannel !== String(settings.viewCountEnrichPerChannel.value) ||
    cadence !== String(settings.syncCadenceMinutes.value) ||
    retention !== String(settings.mediaRetentionDays.value);

  const lookbackError = numberFieldError(lookback, { min: 1, max: 3650, integer: true });
  const maxItemsError = numberFieldError(maxItems, { min: 1, max: 10_000, integer: true });
  const enrichPerChannelError = numberFieldError(enrichPerChannel, { min: 0, max: 200, integer: true });
  const cadenceError = numberFieldError(cadence, { min: 0, max: 10_080, integer: true });
  const retentionError = numberFieldError(retention, { min: 1, max: 3650, integer: true });
  const settingsHasError =
    lookbackError !== null ||
    maxItemsError !== null ||
    enrichPerChannelError !== null ||
    cadenceError !== null ||
    retentionError !== null;

  async function saveSyncSettings() {
    setSavingSettings(true);
    const result = await updateAppSettingsAction({
      syncLookbackDays: Number(lookback),
      maxItemsPerSync: Number(maxItems),
      viewCountEnrichPerChannel: Number(enrichPerChannel),
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

  /** The refusal is a normal outcome, not a fault: the backfill yields to a running sync
   *  by design. It is surfaced as an ordinary message rather than an error toast so it
   *  does not read as something broken. */
  async function startBackfill() {
    setBackfilling(true);
    try {
      const result = await startViewCountBackfillAction();
      if (result.ok) {
        toast.success("Backfill started. Follow it on the Runs screen.");
        router.refresh();
      } else if (result.code === "BACKFILL_BLOCKED") {
        toast.info(result.error);
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start the backfill.");
    } finally {
      setBackfilling(false);
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
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Sync</CardTitle>
          <CardDescription>
            The two rows just below are still <code>.env.local</code>-only, validated at boot. A bad value there stops the app starting
            rather than surfacing later as an empty sync. Lookback, per-sync cap, cadence, and retention underneath those are stored in the
            database and editable here.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <Table>
            <TableBody>
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
            </TableBody>
          </Table>

          <FieldGroup>
            <SettingRow
              label="Lookback window"
              hint="How far back a sync looks by default."
              htmlFor="sync-lookback-days"
              error={lookbackError}
              infoNote={envNote("syncLookbackDays")}
            >
              <NumberField value={lookback} onChange={setLookback} min={1} max={3650} suffix="days" />
            </SettingRow>
            <SettingRow
              label="Per-sync cap"
              hint="Hard safety cap on items fetched across one sync run."
              htmlFor="sync-max-items"
              error={maxItemsError}
              infoNote={envNote("maxItemsPerSync")}
            >
              <NumberField value={maxItems} onChange={setMaxItems} min={1} max={10_000} suffix="posts" />
            </SettingRow>
            <SettingRow
              label="View counts per channel"
              hint={`How many of each channel's newest posts a sync asks Instagram about individually, to recover the play count the listing endpoint withholds. 0 turns the pass off. ${enrichRecommendation(scoreBaselineWindow)}`}
              htmlFor="sync-enrich-per-channel"
              error={enrichPerChannelError}
              infoNote={envNote("viewCountEnrichPerChannel")}
            >
              <NumberField value={enrichPerChannel} onChange={setEnrichPerChannel} min={0} max={200} suffix="posts" />
            </SettingRow>
            <SettingRow
              label="Sync cadence"
              hint="Minutes between automatic syncs."
              htmlFor="sync-cadence-minutes"
              error={cadenceError}
              warnNote={cadence.trim() !== "" && Number(cadence.trim()) === 0 ? "0 disables automatic sync; every sync then only starts from a click." : undefined}
              infoNote={envNote("syncCadenceMinutes")}
            >
              <NumberField value={cadence} onChange={setCadence} min={0} max={10_080} suffix="min" />
            </SettingRow>
            <SettingRow
              label="Asset retention"
              hint="Days of downloaded media to keep."
              htmlFor="sync-media-retention-days"
              error={retentionError}
              warnNote="No reaper reads this. Disk use is unbounded regardless of this number."
              infoNote={envNote("mediaRetentionDays")}
            >
              <NumberField value={retention} onChange={setRetention} min={1} max={3650} suffix="days" />
            </SettingRow>
          </FieldGroup>
        </CardContent>

        <CardFooter>
          <Button onClick={saveSyncSettings} disabled={!settingsDirty || settingsHasError || savingSettings} size="sm" variant="outline">
            {savingSettings ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Backfill blank view counts</CardTitle>
          <CardDescription>
            A sync only enriches each channel&apos;s newest reels, so posts stored while the setting above was 0 still have no play count
            and no outlier score. This asks Instagram about those, oldest debt included, paced and cancelable. It yields to a sync: it will
            not start while one is running, and stops if one begins. Track it on the Runs screen.
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={startBackfill} disabled={backfilling || (isRunning && !stalled)}>
              {backfilling ? "Starting…" : "Run backfill"}
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{live ? "Sync in progress" : "Last sync"}</CardTitle>
          <CardAction>
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
          </CardAction>
        </CardHeader>

        <CardContent>
          {showPanel ? (
            <SyncProgressPanel
              progress={progress}
              stalled={stalled}
              pollError={error}
              onCancel={() => void cancel()}
              onRetry={(channelIds) => void start(channelIds)}
            />
          ) : (
            <>
              <LastJobSummary lastJob={lastJob} />
              {error !== null && <p className="mt-2 text-xs text-destructive">{error}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
