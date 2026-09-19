"use client";

import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import type { RemixRunRow } from "@/server/queries/remix-runs";
import { STAGES } from "./stepper";
import { formatRunElapsed, runTone, runToneLabel, type RunTone } from "./run-log-view";

const STAGE_LABEL = new Map(STAGES.map((s) => [s.key, s.label]));

// Success uses the app's one "good" color; a partial success is the reduced-opacity
// destructive treatment `sync/failure-strip.tsx` already uses for its own "warn" tone
// (never amber — amber is capped at the score and one primary action per screen).
const TONE_CLASS: Record<RunTone, string> = {
  pos: "text-success",
  warn: "text-destructive/70",
  bad: "text-destructive",
};

/**
 * One row per generation attempt, newest first, surviving a restart and a page
 * reload because it reads its own table rather than session state (v1-scope.md,
 * Remix studio P0 #5 / acceptance criterion 5). `runs === null` means "still
 * loading" — kept distinct from an empty array so a fresh session doesn't flash
 * "no attempts yet" for a moment before its first real answer arrives.
 */
export function RunLog({ runs }: { runs: RemixRunRow[] | null }) {
  return (
    <div className="mt-16 border-t border-border pt-4">
      <p className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">Run log</p>
      {runs === null ? null : runs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No generation attempts yet.</p>
      ) : (
        <div className="mt-2 flex flex-col">
          {runs.map((run) => {
            const tone = runTone(run);
            return (
              <div
                key={run.id}
                className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-baseline gap-4 border-b border-border py-2 last:border-b-0"
              >
                <span className="font-mono text-2xs tracking-wide text-muted-foreground">{relativeTime(run.startedAt)}</span>
                <span className="min-w-0 truncate text-sm">
                  <span className="font-medium">{STAGE_LABEL.get(run.stage) ?? run.stage}</span>
                  <span className="text-muted-foreground"> — {run.detail}</span>
                </span>
                <span className={cn("shrink-0 font-mono text-2xs whitespace-nowrap", TONE_CLASS[tone])}>
                  {runToneLabel(tone)} · {formatRunElapsed(run.elapsedMs)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
