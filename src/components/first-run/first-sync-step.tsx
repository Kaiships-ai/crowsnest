"use client";

/**
 * "First sync" — docs/product/v1-scope.md §2 AC 11–14, and per §4 decision 1 the best
 * demonstration in the whole product of the brief's rule that failure is a designed
 * surface: a cold session gets rate-limited by Instagram most of the time, so the very
 * first thing a new install does is very often fail. That deserves the real failure
 * surface, not a smaller one built just for this screen — so this step is a thin wrapper
 * around `useSyncProgress` and `<SyncProgressPanel>` (both landed in 661d72b), the exact
 * components the Channels page and Settings already show a running or finished sync
 * through. Reusing them means the seven-phase progress, the gap list, and the retry
 * affordances are identical here and everywhere else, not a second copy that could drift.
 *
 * "Open Crowsnest" is available the moment the run reaches ANY terminal status — success,
 * partial, or failed (AC 12) — never only on a clean success. Pressing it sets
 * `first_run_completed` (via the existing generic `updateAppSettingsAction`, not a new
 * action) and hands off to the shell, which reads the same `sync_jobs` row through
 * `getFailureStrip()` and shows the failure strip itself if the run didn't fully succeed.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SyncProgressPanel } from "@/components/sync/sync-progress-panel";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { updateAppSettingsAction } from "@/server/actions/settings-actions";

export interface FirstSyncStepProps {
  /** The channels just created on the sources step. Passed through rather than left for
   *  `start()` to default to "everything", so a first sync stays scoped to exactly what
   *  was just chosen even on a database that (per the compound first-run gate) already
   *  had other channels in it. */
  channelIds: string[];
  onOpenCrowsnest: () => void;
}

function headline(status: "running" | "success" | "partial" | "failed" | null): string {
  if (status === null) return "Run the first sync";
  if (status === "running") return "Reading your channels";
  if (status === "success") return "Sync complete";
  return "Sync finished with problems";
}

export function FirstSyncStep({ channelIds, onOpenCrowsnest }: FirstSyncStepProps) {
  const { progress, stalled, start, cancel } = useSyncProgress();
  const [finishing, setFinishing] = useState(false);

  const status = progress?.status ?? null;
  const terminal = status !== null && status !== "running";

  async function openCrowsnest() {
    setFinishing(true);
    await updateAppSettingsAction({ firstRunCompleted: true });
    onOpenCrowsnest();
  }

  return (
    <div>
      <span className="font-mono text-2xs tracking-wide text-faint">04 · FIRST SYNC</span>
      <h1 className="mt-4 text-xl leading-tight font-bold tracking-tight">{headline(status)}</h1>
      <p className="mt-5 max-w-[48ch] text-sm leading-relaxed text-muted-foreground text-balance">
        {status === null
          ? "Instagram rate-limits a cold session, so this first run is the one most likely to hit a snag. That's expected. Whatever it gets back is real, and whatever it doesn't is shown honestly, not hidden."
          : "Every number below is read off this run's own record, not guessed on the client."}
      </p>

      {status === null && (
        <Button className="mt-12" onClick={() => void start(channelIds.length > 0 ? channelIds : undefined)}>
          Run first sync
        </Button>
      )}

      {status !== null && (
        <div className="mt-12">
          <SyncProgressPanel progress={progress} stalled={stalled} onCancel={() => void cancel()} onRetry={(ids) => void start(ids)} />
        </div>
      )}

      {terminal && (
        <Button className="mt-8" onClick={() => void openCrowsnest()} disabled={finishing}>
          {finishing ? "Opening…" : "Open Crowsnest"}
        </Button>
      )}
    </div>
  );
}
