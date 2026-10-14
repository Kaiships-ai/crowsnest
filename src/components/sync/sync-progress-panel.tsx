"use client";

/**
 * The live sync panel. Presentational only — it fetches nothing and owns no state, so
 * every state below can be produced by handing it a `SyncProgress` literal, and the same
 * panel can sit in the sidebar, on a channel page and in Settings without three copies of
 * the polling logic.
 *
 * The bar is determinate on `channelsDone / channelsTotal` and on nothing else. Item
 * counts get no bar at all: Instagram paginates until it decides to stop, so the only
 * denominator available is the configured cap, and a run normally stops at the lookback
 * boundary well short of it. A bar filling towards a ceiling nobody expects to reach is
 * the kind of invented progress this whole feature exists to delete.
 */

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { SyncGap, SyncProgress } from "@/server/services/sync-types";
import {
  channelPercent,
  elapsedMs,
  formatElapsed,
  formatItemsAgainstCap,
  gapDisplayName,
  gapMessage,
  gapRetryLabel,
  retriesLabel,
  stateTone,
  statusDetail,
  statusHeadline,
  syncViewState,
  type SyncTone,
} from "./sync-progress-view";

/**
 * Same palette the sidebar's sync dot uses so one run reads as the same colour in both
 * places: only the two hues globals.css defines, neutral and destructive. `busy` has no
 * dot at all — a run that is actually working gets a Spinner instead, which is the one
 * state where motion means "still going" rather than "look here".
 */
const TONE_DOT: Record<Exclude<SyncTone, "busy">, string> = {
  idle: "bg-muted-foreground",
  ok: "bg-foreground",
  warn: "bg-destructive/50",
  bad: "bg-destructive",
};

function Counter({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <Item variant="outline" size="xs">
      <ItemContent>
        <ItemTitle className={`font-mono tabular-nums ${bad && value > 0 ? "text-destructive" : ""}`}>{value}</ItemTitle>
        <ItemDescription>{label}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

function GapRow({ gap, onRetry }: { gap: SyncGap; onRetry: (channelIds?: string[]) => void }) {
  const retryLabel = gapRetryLabel(gap.code);
  const name = gapDisplayName(gap);
  return (
    <Item variant="outline" size="sm">
      <ItemContent>
        <ItemTitle>{name}</ItemTitle>
        <ItemDescription>{gapMessage(gap)}</ItemDescription>
        {gap.code !== null && (
          // The code is supporting evidence for a bug report, never the explanation —
          // the sentence above it is what the reader is meant to act on.
          <ItemDescription className="font-mono text-2xs text-muted-foreground/70">{gap.code}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        <Button size="xs" variant="outline" aria-label={`${retryLabel} ${name}`} onClick={() => onRetry([gap.channelId])}>
          {retryLabel}
        </Button>
      </ItemActions>
    </Item>
  );
}

export interface SyncProgressPanelProps {
  progress: SyncProgress | null;
  stalled: boolean;
  onCancel: () => void;
  /** No argument means "sync everything"; an array retries exactly those channels. */
  onRetry: (channelIds?: string[]) => void;
  /** The last polling failure, if the caller has one. Rendered next to the last good
   *  numbers rather than in place of them. */
  pollError?: string | null;
}

export function SyncProgressPanel({ progress, stalled, onCancel, onRetry, pollError = null }: SyncProgressPanelProps) {
  const state = syncViewState(progress, stalled);
  const tone = stateTone(state);
  const headline = statusHeadline(state, progress);
  const detail = statusDetail(state, progress);
  const gaps = progress?.gaps ?? [];
  const percent = progress === null ? null : channelPercent(progress.channelsDone, progress.channelsTotal);
  const retries = progress === null ? null : retriesLabel(progress.retries);

  const meta: string[] = [];
  if (progress !== null) {
    meta.push(`${state === "running" || state === "cancelling" || state === "stalled" ? "running for" : "took"} ${formatElapsed(elapsedMs(progress))}`);
    // A retry already recovered; it belongs with the neutral facts, not with the errors.
    if (retries !== null) meta.push(retries);
    if (progress.lookbackDays !== null) meta.push(`${progress.lookbackDays}-day lookback`);
  }

  // Nothing to group when a finished, gapless run has no control to offer — an empty
  // ButtonGroup would still render its own role="group" box.
  const hasActions = state === "running" || state === "cancelling" || state === "stalled" || gaps.length > 0;

  return (
    // `role`/`aria-label` are explicit because Card renders a div: the panel was a named
    // <section>, which is a region, and callers (the first-run sync step) name it.
    <Card size="sm" role="region" aria-label="Sync progress">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2" role="status" aria-live="polite">
            {tone === "busy" ? (
              <Spinner aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium">{headline}</p>
              {detail !== null && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
            </div>
          </div>

          {hasActions && (
            <ButtonGroup className="shrink-0">
              {(state === "running" || state === "cancelling") && (
                <Button size="sm" variant="outline" onClick={onCancel} disabled={state === "cancelling"}>
                  {state === "cancelling" ? "Cancelling…" : "Cancel"}
                </Button>
              )}
              {state === "stalled" && (
                <Button size="sm" onClick={() => onRetry()}>
                  Start a new sync
                </Button>
              )}
              {gaps.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => onRetry(gaps.map((gap) => gap.channelId))}>
                  Retry {gaps.length} failed
                </Button>
              )}
            </ButtonGroup>
          )}
        </div>

        {progress !== null && (
          <>
            {percent === null ? (
              <div>
                <Progress value={null} aria-valuetext="resolving the channel list">
                  <ProgressLabel className="text-xs font-normal text-muted-foreground">Channels</ProgressLabel>
                  <span className="ml-auto text-xs text-muted-foreground">resolving channels</span>
                </Progress>
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  The run hasn&apos;t enumerated its channel list yet, so there is no fraction to draw.
                </p>
              </div>
            ) : (
              <Progress
                value={progress.channelsDone}
                min={0}
                max={progress.channelsTotal ?? undefined}
                aria-valuetext={`${progress.channelsDone} of ${progress.channelsTotal} channels`}
              >
                <ProgressLabel className="text-xs font-normal text-muted-foreground">Channels</ProgressLabel>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {progress.channelsDone} / {progress.channelsTotal} · {percent}%
                </span>
              </Progress>
            )}

            <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>

            <Item variant="outline" size="xs">
              <ItemContent>
                <ItemTitle className="font-mono tabular-nums">
                  {formatItemsAgainstCap(progress.itemsSeen, progress.maxItems)}
                </ItemTitle>
                <ItemDescription>
                  posts seen — Instagram never says how many there are, so the per-sync cap is the only denominator
                </ItemDescription>
              </ItemContent>
            </Item>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Counter label="created" value={progress.itemsCreated} />
              <Counter label="updated" value={progress.itemsUpdated} />
              <Counter label="failed" value={progress.itemsFailed} bad />
              <Counter label="deleted" value={progress.itemsDeleted} />
              <Counter label="assets saved" value={progress.assetsDownloaded} />
              <Counter label="assets failed" value={progress.assetsFailed} bad />
            </div>

            {progress.errorCode !== null && <p className="font-mono text-2xs text-destructive">{progress.errorCode}</p>}

            {gaps.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {gaps.length} channel{gaps.length === 1 ? "" : "s"} didn&apos;t finish
                </h3>
                <ItemGroup>
                  {gaps.map((gap) => (
                    <GapRow key={gap.channelId} gap={gap} onRetry={onRetry} />
                  ))}
                </ItemGroup>
              </div>
            )}
          </>
        )}

        {pollError !== null && (
          <p className="text-xs text-destructive">
            Progress updates are failing: {pollError}
            {progress === null ? "" : " — the numbers above are the last ones that arrived."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
