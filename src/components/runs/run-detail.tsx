"use client";

import { useEffect, useState } from "react";
import { ScrollText, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { StatTile } from "@/components/dashboard/stat-tile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toggle } from "@/components/ui/toggle";
import { formatDuration } from "@/lib/format";
import { enrichedFromEvents } from "@/lib/run-enrichment";
import { cn } from "@/lib/utils";
import { cancelSyncAction } from "@/server/actions/sync-actions";
import { classifyIgError, isIgErrorCode, type IgErrorClass } from "@/server/ig/errors";
import type { LogEventRow, StoredLogLevel } from "@/server/logs/store";
import type { RunDetail as RunDetailData, RunStatus, RunSummary } from "@/server/queries/runs";
import { evaluateSla } from "@/server/runs/sla";
import { SYNC_STALL_SECONDS, type SyncGap } from "@/server/services/sync-types";
import { gapDisplayName, gapMessage, stopReasonLabel } from "@/components/sync/sync-progress-view";
import type { StopReason } from "@/server/services/sync-types";
import { useRunStream } from "./use-run-stream";

/**
 * Run detail (Runs and observability, spec 2026-08-02, screen 2). Seeded from the
 * server's `getRun()` read, then kept live by `useRunStream(runId, [run])` — the header
 * status comes from the `runs` array the stream pushes (find this run by id), the trace
 * tail comes from `events`. Same split runs-list.tsx uses for the list screen.
 */

/** The earliest error event in a trace, by id (events arrive newest-first, so the lowest
 *  id is the earliest). Null when the run logged no error. Drives the failure-first
 *  callout, so a failed run points at its cause instead of the top of a long trace. */
export function firstErrorEvent(events: LogEventRow[]): LogEventRow | null {
  let earliest: LogEventRow | null = null;
  for (const e of events) {
    if (e.level === "error" && (earliest === null || e.id < earliest.id)) earliest = e;
  }
  return earliest;
}

/** A gap's error class (transient/auth/challenge/fatal), from the classifier T1 shipped
 *  in `server/ig/errors.ts`. Null when the gap carries no code, or a code the classifier
 *  doesn't recognize — never guessed, per the no-fabrication rule. */
export function gapErrorClass(code: string | null): IgErrorClass | null {
  return code !== null && isIgErrorCode(code) ? classifyIgError(code) : null;
}

// Transient is a normal retry, so it reads neutral; auth/challenge/fatal all mean "this
// will not fix itself," so they share the destructive tone the rest of this screen
// already uses for stalled and over-budget.
const GAP_CLASS_BADGE: Record<IgErrorClass, "outline" | "destructive"> = {
  transient: "outline",
  auth: "destructive",
  challenge: "destructive",
  fatal: "destructive",
};

/** The run's status as one badge. The word is the signal; the variant only reinforces
 *  it, and `running`/`waiting` add a Spinner because the run is actually working.
 *  `success` has no badge variant of its own, so it borrows the shared `--success`
 *  token the dashboard's stat tiles already use for a good delta. */
const STATUS_BADGE: Record<RunStatus, { variant: "secondary" | "outline" | "destructive"; className?: string }> = {
  running: { variant: "secondary" },
  waiting: { variant: "secondary" },
  success: { variant: "secondary", className: "text-success" },
  partial: { variant: "outline", className: "text-muted-foreground" },
  failed: { variant: "destructive" },
  canceled: { variant: "outline", className: "text-muted-foreground" },
};

const STATUS_WORD_LABEL: Record<RunStatus, string> = {
  running: "Running",
  waiting: "Waiting",
  success: "Success",
  partial: "Partial",
  failed: "Failed",
  canceled: "Canceled",
};

// Same convention logs-view.tsx's LEVEL_LABEL_CLASS uses: info leans on muted text,
// warn on full foreground, error on the destructive token. Amber is never a log level.
const LEVEL_LABEL_CLASS: Record<StoredLogLevel, string> = {
  info: "text-muted-foreground",
  warn: "text-foreground",
  error: "text-destructive",
};

// The staleness threshold the sidebar's own "stalled" read already uses (sync-types.ts's
// isSyncStalled) — not the reaper's longer lock-steal threshold, which lives inside
// sync-engine.ts and is Task 12's alone to touch. Mirrors runs-list.tsx's STALE_MS
// exactly so the two screens never disagree about what "stuck" means.
const STALE_MS = SYNC_STALL_SECONDS * 1000;

function budgetMsFor(type: RunSummary["type"], syncSlaMinutes: number, remixSlaMinutes: number): number {
  return (type === "remix" ? remixSlaMinutes : syncSlaMinutes) * 60_000;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

/** Finer grained than lib/format's relativeTime (which starts at "Xm ago") — a
 *  heartbeat a few seconds stale still reads as healthy, so this needs second
 *  resolution near zero, the same reason the mockup's heartbeat line reads "4s ago". */
function agoLabel(iso: string | null, now: number): string {
  if (iso === null) return "—";
  const ms = now - new Date(iso).getTime();
  if (ms < 1000) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export interface RunDetailProps {
  run: RunDetailData;
  syncSlaMinutes: number;
  remixSlaMinutes: number;
}

export function RunDetail({ run, syncSlaMinutes, remixSlaMinutes }: RunDetailProps) {
  // Seeding `runs` with `[run]` means `liveRun` below resolves correctly on first paint,
  // before the first SSE message lands, the same way runs-list.tsx seeds its whole table.
  const { runs, events: streamEvents, connected } = useRunStream(run.runId, [run]);
  const liveRun: RunSummary = runs.find((r) => r.runId === run.runId) ?? run;

  // The hook has no seed for `events` (only for `runs`), so its own state starts empty
  // and only fills in once the first SSE tick lands. Falling back to the server-seeded
  // `run.events` covers that brief window without touching use-run-stream.ts.
  const liveEvents = streamEvents.length > 0 ? streamEvents : run.events;

  // "Follow live" pauses the trace tail on a frozen snapshot rather than stopping the
  // subscription (the header above keeps updating either way) — captured at the moment
  // it's turned off, in the click handler itself, never inside an effect.
  const [followLive, setFollowLive] = useState(true);
  const [pausedEvents, setPausedEvents] = useState<LogEventRow[] | null>(null);
  const displayEvents = followLive ? liveEvents : (pausedEvents ?? liveEvents);
  const firstError = firstErrorEvent(displayEvents);

  function toggleFollowLive() {
    if (followLive) {
      setPausedEvents(liveEvents);
      setFollowLive(false);
    } else {
      setPausedEvents(null);
      setFollowLive(true);
    }
  }

  // Lazy initial: a failed run lands with its first error already expanded, so the reason
  // is on screen instead of buried down a long trace. Seeded from `run.events` (the
  // server read) because the stream has not ticked yet on first paint.
  const [openId, setOpenId] = useState<number | null>(() => firstErrorEvent(run.events)?.id ?? null);

  // Ticks once a second, only while the run is actually running, so elapsed and
  // heartbeat-ago read smoothly between the stream's ~2s polls instead of jumping. Same
  // pattern as failure-strip.tsx's cooldown countdown: initial state read at render, the
  // interval only ever calls setState from its own callback, never from the effect body.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (liveRun.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveRun.status]);

  const startedAtMs = new Date(liveRun.startedAt).getTime();
  const elapsedMs = liveRun.status === "running" ? Math.max(0, now - startedAtMs) : liveRun.durationMs;
  const budgetMs = budgetMsFor(liveRun.type, syncSlaMinutes, remixSlaMinutes);
  const overMs = Math.max(0, now - startedAtMs - budgetMs);
  const verdict = evaluateSla({
    status: liveRun.status,
    startedAt: liveRun.startedAt,
    heartbeatAt: liveRun.heartbeatAt,
    budgetMs,
    staleMs: STALE_MS,
    now,
  });

  const [cancelling, setCancelling] = useState(false);
  const canCancel = liveRun.status === "running" && liveRun.type === "sync";

  async function handleCancel() {
    setCancelling(true);
    try {
      const result = await cancelSyncAction(liveRun.runId);
      if (!result.ok) toast.error(result.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel the run.");
    } finally {
      setCancelling(false);
    }
  }

  // No per-tile tone: `StatTile` (the dashboard's own tile, reused here rather than
  // re-drawn) renders one value treatment, so a non-zero Failed count reads through the
  // number itself and through the run's status badge above, not through a red figure.
  const tiles: { key: string; label: string; value: string }[] = [
    { key: "seen", label: "Seen", value: String(liveRun.itemsSeen) },
    { key: "created", label: "Created", value: String(liveRun.itemsCreated) },
    { key: "updated", label: "Updated", value: String(liveRun.itemsUpdated) },
    { key: "failed", label: "Failed", value: String(liveRun.itemsFailed) },
  ];
  if (liveRun.channelsTotal !== null) {
    tiles.push({ key: "channels", label: "Channels", value: `${liveRun.channelsDone ?? 0} / ${liveRun.channelsTotal}` });
  }
  // Recomputed from the trace rather than read off `run` so the number moves while a run
  // is in flight: the SSE stream carries events but its run summaries have no enriched
  // field. Falls back to the server's value for the first paint, before the stream ticks.
  // Absent (not zero) when the pass never ran, so the tile does not appear at all rather
  // than printing a 0 that would read as "asked, and got nothing back".
  const enriched = enrichedFromEvents(liveEvents) ?? run.itemsEnriched;
  if (enriched !== null) {
    tiles.push({ key: "enriched", label: "Enriched", value: String(enriched) });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <Badge variant={STATUS_BADGE[liveRun.status].variant} className={STATUS_BADGE[liveRun.status].className}>
              {(liveRun.status === "running" || liveRun.status === "waiting") && <Spinner aria-hidden className="size-3" />}
              {STATUS_WORD_LABEL[liveRun.status]}
            </Badge>
          </CardTitle>
          <CardDescription className="font-mono">
            run_id {liveRun.runId} &middot; {liveRun.type}
          </CardDescription>
          {(verdict.stuck || verdict.overBudget) && (
            <CardAction>
              <Badge variant="destructive">
                {verdict.stuck
                  ? `Stalled, no heartbeat ${agoLabel(liveRun.heartbeatAt, now)}`
                  : `SLA over by ${formatDuration(Math.floor(overMs / 1000))}`}
              </Badge>
            </CardAction>
          )}
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-6 text-xs text-muted-foreground">
            <span>
              Started <span className="font-mono">{formatClock(liveRun.startedAt)}</span>
            </span>
            <span>
              Elapsed <span className="font-mono">{formatDuration(Math.floor(elapsedMs / 1000))}</span>
            </span>
            <span>
              Heartbeat <span className="font-mono">{agoLabel(liveRun.heartbeatAt, now)}</span>
            </span>
            <span>
              Budget <span className="font-mono">{formatDuration(Math.floor(budgetMs / 1000))}</span>
            </span>
            {stopReasonLabel((liveRun.stopReason ?? null) as StopReason | null) && (
              <span>
                Ended <span className="font-mono">{stopReasonLabel((liveRun.stopReason ?? null) as StopReason | null)}</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {tiles.map((tile) => (
              <StatTile key={tile.key} label={tile.label} value={tile.value} />
            ))}
          </div>
        </CardContent>

        <CardFooter>
          <ButtonGroup>
            {canCancel && (
              <Button variant="destructive" size="sm" disabled={cancelling} onClick={() => void handleCancel()}>
                Cancel run
              </Button>
            )}
            <Toggle variant="outline" size="sm" pressed={followLive} onPressedChange={toggleFollowLive}>
              {followLive ? "Following live" : "Follow live"}
            </Toggle>
          </ButtonGroup>
        </CardFooter>
      </Card>

      {firstError && liveRun.status !== "running" && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>First error</AlertTitle>
          <AlertDescription>
            {/* The event name is the control: pressing it opens that row's fields down
                in the trace, which is why a failed run lands with it already expanded. */}
            <Button variant="outline" size="sm" className="font-mono" onClick={() => setOpenId(firstError.id)}>
              {firstError.event}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {run.gaps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Gaps &middot; {run.gaps.length} channel{run.gaps.length === 1 ? "" : "s"} didn&apos;t finish
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              {run.gaps.map((gap, i) => (
                <GapRow key={`${gap.channelId}-${i}`} gap={gap} />
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Trace &middot; log events for run_id {liveRun.runId}</CardTitle>
          <CardAction>
            {/* A liveness indicator, not a busy one: the dot says the SSE subscription is
                still attached, it is not reporting work in progress. */}
            <span className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
              <span aria-hidden className={cn("size-1.5 rounded-full", connected ? "bg-foreground animate-pulse" : "bg-muted-foreground")} />
              {connected ? "Live" : "Reconnecting…"}
            </span>
          </CardAction>
        </CardHeader>

        <CardContent>
          {displayEvents.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ScrollText />
                </EmptyMedia>
                <EmptyTitle>No trace events yet for this run.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Time</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayEvents.map((e) => {
                  const open = openId === e.id;
                  return (
                    <TableRow
                      key={e.id}
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} fields for ${e.event}`}
                      onClick={() => setOpenId(open ? null : e.id)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setOpenId(open ? null : e.id);
                        }
                      }}
                      className="cursor-pointer align-top"
                    >
                      <TableCell className="font-mono text-muted-foreground">{formatTs(e.ts)}</TableCell>
                      <TableCell className={cn("font-medium", LEVEL_LABEL_CLASS[e.level])}>{e.level}</TableCell>
                      <TableCell className="text-muted-foreground">{e.source}</TableCell>
                      <TableCell className="font-mono">
                        {e.event}
                        {open && (
                          <pre className="mt-2 max-w-full overflow-x-auto rounded-lg bg-background p-2 font-mono text-2xs text-muted-foreground">
                            {JSON.stringify(e.fields, null, 2)}
                          </pre>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** One gap row: channel, why it didn't come back, and the code's error class (when the
 *  code is one this app recognizes — see `gapErrorClass`). Mirrors `failure-strip.tsx`'s
 *  gap row (same `gapDisplayName`/`gapMessage` helpers), plus the class label that
 *  screen has no room for. */
function GapRow({ gap }: { gap: SyncGap }) {
  const errorClass = gapErrorClass(gap.code);
  return (
    <Item variant="outline" size="sm">
      <ItemContent>
        <ItemTitle className="truncate">{gapDisplayName(gap)}</ItemTitle>
        <ItemDescription className="font-mono text-2xs">{gapMessage(gap)}</ItemDescription>
      </ItemContent>
      {errorClass && (
        <ItemActions>
          <Badge variant={GAP_CLASS_BADGE[errorClass]} className="font-mono uppercase">
            {errorClass}
          </Badge>
        </ItemActions>
      )}
    </Item>
  );
}
