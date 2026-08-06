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
    <div className="flex items-start gap-2.5">
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT_TONE.bad)} />
      <div className="min-w-0">
        <p className="text-sm text-foreground">
          {jobs.length === 1 ? "One job is stuck." : `${jobs.length} jobs are stuck.`}
        </p>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {jobs.map((job) => (
            <li key={job.jobId} className="text-xs text-muted-foreground">
              {job.label} has not reported for {silentFor(job.silentForMs)}.
            </li>
          ))}
        </ul>
        <Link href="/runs" className="mt-1.5 inline-block text-xs text-foreground underline underline-offset-2">
          Open Runs
        </Link>
      </div>
    </div>
  );
}

export function StackHealthPanel({ sidecar, llm, hasLlmKey, lastSync, running, checkedAtMs }: StackHealthPanelProps) {
  const summary = summarizeLastSync(lastSync);
  const stuck = selectStuckJobs(running, checkedAtMs);
  const tone = stackTone({ sidecar, llm, lastSync: summary, stuckCount: stuck.length });

  return (
    <section
      aria-label="Stack health"
      className={cn(
        "flex flex-col gap-4 bg-card px-5 py-4",
        tone === "ok" ? "border-l-2 border-border" : "border-l-2 border-destructive",
        tone === "warn" && "border-destructive/50",
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT_TONE[tone])} />
        <p className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">Stack health</p>
      </div>

      <DependencyStatusPanel sidecar={sidecar} llm={llm} hasLlmKey={hasLlmKey} />

      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2.5">
          <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT_TONE[lastSyncTone(summary)])} />
          <div className="min-w-0">
            <p className="text-sm text-foreground">{lastSyncHeadline(summary)}</p>
            {summary.detail && <p className="mt-0.5 text-xs text-muted-foreground">{summary.detail}</p>}
          </div>
        </div>

        {stuck.length > 0 ? (
          <StuckRow jobs={stuck} />
        ) : (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden className={cn("size-1.5 rounded-full", DOT_TONE.ok)} />
            {running.length === 0
              ? "No jobs are running."
              : `${running.length} job${running.length === 1 ? "" : "s"} running, all reporting in.`}
          </p>
        )}
      </div>
    </section>
  );
}
