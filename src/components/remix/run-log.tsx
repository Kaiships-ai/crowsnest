"use client";

import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import type { RemixRunRow } from "@/server/queries/remix-runs";
import { STAGES } from "./stepper";
import { formatRunElapsed, runTone, runToneLabel, type RunTone } from "./run-log-view";

const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

// Success uses the app's one "good" color; a partial success is the reduced-opacity
// destructive treatment `sync/failure-strip.tsx` already uses for its own "warn" tone.
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
 *
 * The zero-rows case stays a single muted line rather than an `Empty`: this is a
 * subordinate log inside a stage, not a whole view with nothing in it.
 */
export function RunLog({ runs }: { runs: RemixRunRow[] | null }) {
  return (
    <div className="mt-16 flex flex-col gap-3">
      <Separator />
      <p className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">Run log</p>
      {runs === null ? null : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No generation attempts yet.</p>
      ) : (
        <Table>
          <TableBody>
            {runs.map((run) => {
              const tone = runTone(run);
              return (
                <TableRow key={run.id}>
                  <TableCell className="w-[88px] align-baseline font-mono text-2xs tracking-wide text-muted-foreground">
                    {relativeTime(run.startedAt)}
                  </TableCell>
                  {/* max-w-0 is what lets a long `detail` truncate inside a table cell
                      instead of widening the whole table into its scroll container. */}
                  <TableCell className="max-w-0 truncate align-baseline">
                    <span className="font-medium">{STAGE_LABEL[run.stage] ?? run.stage}</span>
                    <span className="text-muted-foreground"> — {run.detail}</span>
                  </TableCell>
                  <TableCell className={cn("w-px text-right align-baseline font-mono text-2xs", TONE_CLASS[tone])}>
                    {runToneLabel(tone)} · {formatRunElapsed(run.elapsedMs)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
