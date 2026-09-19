/**
 * The stack health view (enhancements spec M4-U8): the four things that decide whether
 * this app can do anything right now, in one block at the top of the dashboard —
 * Instagram sidecar, model backend, last sync, and any stuck job.
 *
 * Deliberately a server component wrapping the existing client one rather than a rewrite.
 * `DependencyStatusPanel` already owns the two live pings, their re-check button, and the
 * hard-won false-green rules in `dependency-status.ts`; forking any of that to get two
 * more rows would mean two answers to "is the backend up". So the two dependency rows
 * stay exactly as they were and this adds the two the database can answer, under one
 * heading that says how the stack reads overall.
 *
 * Quiet when healthy, in the same register as the panel it wraps: no run is in trouble,
 * so the last-sync and stuck rows are one muted line each, and only a real problem earns
 * a destructive rule down the side.
 */

import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { DependencyStatusPanel } from "./dependency-status-panel";
import {
  selectStuckJobs,
  stackTone,
  summarizeLastSync,
  type LastSyncRow,
  type LastSyncSummary,
  type RunningJob,
  type StuckJob,
} from "./stack-health";
import type { LlmStatus, SidecarStatus } from "./dependency-status";

export interface StackHealthPanelProps {
  sidecar: SidecarStatus;
  llm: LlmStatus;
  hasLlmKey: boolean;
  lastSync: LastSyncRow | null;
  running: RunningJob[];
  /** When the rows above were read — see `getStackHealth`'s own note on why the clock is
   *  read there and not here. */
  checkedAtMs: number;
}

const DOT_TONE = {
  ok: "bg-muted-foreground/40",
  warn: "bg-muted-foreground",
  bad: "bg-destructive",
} as const;

function lastSyncHeadline(summary: LastSyncSummary): string {
  // `at` is null only in the "never" state, which is handled before anything reads it —
  // no run means there is no time to render, not a time to render as "just now".
  if (summary.state === "never" || summary.at === null) return "Nothing has synced yet.";

  const when = relativeTime(summary.at);
  switch (summary.state) {
    case "running":
      return `A sync has been running since ${when}.`;
    case "success":
      return `Last sync succeeded ${when}.`;
    case "partial":
      return `Last sync finished with gaps ${when}.`;
    case "failed":
      return `Last sync failed ${when}.`;
  }
}

function lastSyncTone(summary: LastSyncSummary): "ok" | "warn" | "bad" {
  if (summary.state === "failed") return "bad";
  if (summary.state === "partial" || summary.state === "never") return "warn";
  return "ok";
}

/** Whole minutes, floored, because that is all this number is worth: it exists to say
 *  "long enough that something is wrong", not to be a stopwatch. */
function silentFor(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes === 1) return "1 minute";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

function StuckRow({ jobs }: { jobs: StuckJob[] }) {
  return (
    <Item size="sm">
      <ItemMedia>
        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT_TONE.bad)} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{jobs.length === 1 ? "One job is stuck." : `${jobs.length} jobs are stuck.`}</ItemTitle>
        {jobs.map((job) => (
          <ItemDescription key={job.jobId}>
            {job.label} has not reported for {silentFor(job.silentForMs)}.
          </ItemDescription>
        ))}
      </ItemContent>
      <ItemActions>
        <Link href="/runs" className="text-xs text-foreground underline underline-offset-2">
          Open Runs
        </Link>
      </ItemActions>
    </Item>
  );
}

export function StackHealthPanel({ sidecar, llm, hasLlmKey, lastSync, running, checkedAtMs }: StackHealthPanelProps) {
  const summary = summarizeLastSync(lastSync);
  const stuck = selectStuckJobs(running, checkedAtMs);
  const tone = stackTone({ sidecar, llm, lastSync: summary, stuckCount: stuck.length });

  return (
    // Still a named region (Card renders a div, so the role is explicit): this block is
    // the dashboard's landmark for "can the app do anything right now".
    <Card
      size="sm"
      role="region"
      aria-label="Stack health"
      className={cn(
        "border",
        tone === "ok" ? "border-border" : "border-destructive",
        tone === "warn" && "border-destructive/50",
      )}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT_TONE[tone])} />
          Stack health
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <DependencyStatusPanel sidecar={sidecar} llm={llm} hasLlmKey={hasLlmKey} />

        <ItemGroup>
          <Item size="sm">
            <ItemMedia>
              <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT_TONE[lastSyncTone(summary)])} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{lastSyncHeadline(summary)}</ItemTitle>
              {summary.detail && <ItemDescription>{summary.detail}</ItemDescription>}
            </ItemContent>
          </Item>

          {stuck.length > 0 ? (
            <StuckRow jobs={stuck} />
          ) : (
            // Quiet when healthy: one muted line, not a row with a heading.
            <Item size="xs">
              <ItemMedia>
                <span aria-hidden className={cn("size-1.5 rounded-full", DOT_TONE.ok)} />
              </ItemMedia>
              <ItemContent>
                <ItemDescription>
                  {running.length === 0
                    ? "No jobs are running."
                    : `${running.length} job${running.length === 1 ? "" : "s"} running, all reporting in.`}
                </ItemDescription>
              </ItemContent>
            </Item>
          )}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
