"use client";

/**
 * The shell's failure strip. Every route under `(shell)` renders one instance, fed a
 * `FailureStrip` snapshot from `getFailureStrip()` — see `topbar.tsx`, which is the only
 * caller. That snapshot is read once per server render, so this component also watches
 * `useSyncProgress()` for the live run: the moment a poll reports `status === "running"`
 * (whether that run was started here, from the sidebar, or from another tab) the strip
 * hides itself rather than arguing with the progress bar over what's currently true.
 *
 * Failure is the normal state here, not an exception dressed as one — the brief is
 * explicit that this must never read as a red alert bar. So it is a default-variant
 * `Alert` announced politely, and only its border and its dot carry severity, both
 * drawn from the same two hues `sync-progress-panel.tsx`'s `TONE_DOT` already uses:
 * neutral and destructive.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
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

// Severity rides on the strip's own border, not on a red wash over the whole bar: the
// Alert stays the default variant so a failure reads as a normal state with a coloured
// edge, which is the whole point of this surface.
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

  // An empty ButtonGroup would still draw its own role="group" box, and a settled
  // connection-level kind can legitimately offer no control at all.
  const hasActions = action.kind !== "none" || strip.gaps.length > 0 || (strip.kind === "partial" && strip.jobId !== null);

  return (
    // `role="status"` / `aria-live="polite"`, not Alert's own `role="alert"`: failure is
    // the normal state on this strip, so it is announced politely rather than as an
    // interruption. Severity is the border colour and the dot; the variant stays default
    // so the bar never turns into a red wash.
    <Alert
      role="status"
      aria-live="polite"
      className={cn("grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6 gap-y-3", TONE_RULE[copy.tone])}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[copy.tone])} />
        <div className="min-w-0">
          <AlertTitle>{copy.title}</AlertTitle>
          <AlertDescription>{copy.headline}</AlertDescription>
          {strip.kind === "cooldown" && <AlertDescription>{formatCooldownWait(remaining)}</AlertDescription>}
          {copy.facts.length > 0 && <AlertDescription className="font-mono text-2xs">{copy.facts}</AlertDescription>}
        </div>
      </div>

      {/* Secondary, never the screen's primary action. This strip renders on every
          screen, so a primary-weight recovery control here would compete with whatever
          that screen's own one primary action is: Remix on the detail page, the rescore
          save on Settings. */}
      {hasActions && (
        <ButtonGroup className="shrink-0">
          {action.kind === "settings" ? (
            // Stays a Link rather than `<Button render={<Link/>}>`: Base UI's Button
            // either warns about a non-button element or, with `nativeButton={false}`,
            // overrides the anchor's role. `data-slot` is what ButtonGroup joins on.
            <Link href="/settings" data-slot="button" className={buttonVariants({ size: "sm", variant: "secondary" })}>
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
              size="icon-sm"
              variant="ghost"
              aria-label="Dismiss this notice"
              title="Dismiss"
              onClick={() => setDismissedJobId(strip.jobId)}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </ButtonGroup>
      )}

      {detailOpen && strip.gaps.length > 0 && (
        <div className="col-span-2">
          <Separator className="mb-3" />
          <h3 className="text-xs font-medium text-muted-foreground">What didn&apos;t come back</h3>
          <ItemGroup className="mt-2">
            {strip.gaps.map((gap) => (
              <Item key={gap.channelId} size="xs">
                <ItemContent>
                  <ItemTitle className="truncate">{gapDisplayName(gap)}</ItemTitle>
                </ItemContent>
                <ItemDescription className="shrink-0 text-right font-mono text-2xs">{gapMessage(gap)}</ItemDescription>
              </Item>
            ))}
          </ItemGroup>
        </div>
      )}
    </Alert>
  );
}
