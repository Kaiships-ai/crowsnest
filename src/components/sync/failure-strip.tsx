"use client";

/**
 * The shell's failure strip. Every route under `(shell)` renders one instance, fed a
 * `FailureStrip` snapshot from `getFailureStrip()` — see `topbar.tsx`, which is the only
 * caller. That snapshot is read once per server render, so this component also watches
 * `useSyncProgress()` for the live run: the moment a poll reports `status === "running"`
 * (whether that run was started here, from the sidebar, or from another tab) the strip
 * hides itself rather than arguing with the progress bar over what's currently true.
 *
 * Failure is the normal state here, not an exception dressed as one — DESIGN.md and the
 * brief are both explicit that this must never read as a red alert bar. Only the left
 * rule and the dot carry severity, both drawn from the same two hues `sync-progress-
 * panel.tsx`'s `TONE_DOT` already uses (neutral/destructive), never amber — amber is the
 * score's colour alone.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FailureStrip as FailureStripData } from "@/server/queries/failure-surface";
import {
  cooldownRemainingSec,
  failureStripAction,
  failureStripCopy,
  formatCooldownWait,
  gapDisplayName,
  gapMessage,
} from "./failure-strip-view";
import { useSyncProgress } from "./use-sync-progress";

const TONE_RULE: Record<"warn" | "bad", string> = {
  warn: "border-destructive/50",
  bad: "border-destructive",
};

const TONE_DOT: Record<"warn" | "bad", string> = {
  warn: "bg-destructive/50",
  bad: "bg-destructive",
};

export interface FailureStripProps {
  strip: FailureStripData;
}

export function FailureStrip({ strip }: FailureStripProps) {
  const { progress, start } = useSyncProgress();
  const [detailOpen, setDetailOpen] = useState(false);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A live countdown, but not a guessed one: it re-derives from `finishedAt` +
  // Instagram's own `cooldownRetryAfterSec` every second, it never accumulates drift of
  // its own. Only ticks while a cooldown with a real countdown is actually on screen.
  useEffect(() => {
    if (strip.kind !== "cooldown" || strip.cooldownRetryAfterSec === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [strip.kind, strip.cooldownRetryAfterSec]);

  // The live poll can know about a newer run than the server-rendered `strip` prop —
  // the prop only refreshes on navigation (see topbar.tsx / the shell layout), while
  // this hook polls every second while something is running. A run in flight, from
  // anywhere, always outranks a stale verdict.
  if (progress !== null && progress.status === "running") return null;
  if (strip.jobId !== null && strip.jobId === dismissedJobId) return null;

  const copy = failureStripCopy(strip);
  if (copy === null) return null;

  const remaining = strip.kind === "cooldown" ? cooldownRemainingSec(strip, now) : null;
  const action = failureStripAction(strip, remaining);

  function runAction() {
    if (action.kind === "retry_all") void start();
    else if (action.kind === "retry_gaps") void start(strip.gaps.map((g) => g.channelId));
    else if (action.kind === "copy_command") void navigator.clipboard?.writeText("npm run ig:service");
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-wrap items-start gap-x-6 gap-y-3 border-l-2 bg-card px-5 py-3.5", TONE_RULE[copy.tone])}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[copy.tone])} />
        <div className="min-w-0">
          <p className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">{copy.title}</p>
          <p className="mt-1 text-sm text-foreground">{copy.headline}</p>
          {strip.kind === "cooldown" && <p className="mt-1 text-xs text-muted-foreground">{formatCooldownWait(remaining)}</p>}
          {copy.facts.length > 0 && <p className="mt-1.5 font-mono text-2xs text-muted-foreground">{copy.facts}</p>}
        </div>
      </div>

      {/* Secondary, not amber. This strip renders on every screen, so an amber action
          here would compete with whatever that screen's own primary action is: Remix on
          the detail page, the rescore save on Settings. Amber means one thing in this
          design, a post beat its channel, and it gets one primary per screen. A recovery
          control that follows Kai everywhere cannot be that one. */}
      <div className="flex shrink-0 items-center gap-2">
        {action.kind === "settings" ? (
          <Link href="/settings" className={buttonVariants({ size: "sm", variant: "secondary" })}>
            {action.label}
          </Link>
        ) : action.kind !== "none" ? (
          <Button size="sm" variant="secondary" onClick={runAction} disabled={action.disabled}>
            {action.label}
          </Button>
        ) : null}

        {strip.gaps.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setDetailOpen((v) => !v)} aria-expanded={detailOpen}>
            {detailOpen ? "Hide detail" : "What didn't come back"}
          </Button>
        )}

        {/* Only `partial` self-heals without a human doing anything about it — every
            connection-level kind stays until its cause is actually fixed, so it has no
            dismiss control to lie with. */}
        {strip.kind === "partial" && strip.jobId !== null && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Dismiss this notice"
            title="Dismiss"
            onClick={() => setDismissedJobId(strip.jobId)}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {detailOpen && strip.gaps.length > 0 && (
        <div className="w-full border-t border-border pt-3">
          <h3 className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">What didn&apos;t come back</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {strip.gaps.map((gap) => (
              <li key={gap.channelId} className="flex items-baseline justify-between gap-4 border-b border-border py-1.5">
                <span className="min-w-0 truncate text-sm text-foreground">{gapDisplayName(gap)}</span>
                <span className="shrink-0 text-right font-mono text-2xs text-muted-foreground">{gapMessage(gap)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
