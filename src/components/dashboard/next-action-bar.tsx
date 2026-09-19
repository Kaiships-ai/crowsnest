import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NextAction {
  /** The single most useful thing to do next, given the current state. */
  label: string;
  href: string;
  /** One short line saying why this is the recommendation. */
  reason: string;
}

/**
 * The dashboard's spine: the one next action, decided from state, plus a few standing
 * shortcuts. The goal's dashboard is a decision surface ("what do I do next"), not a KPI
 * wall, so this sits at the very top. The primary action is the only amber affordance on
 * the screen (the amber law: amber is scores and exactly one primary action). Purely
 * link-based, so it never duplicates the sidebar's own sync-trigger logic.
 */
export function NextActionBar({ next }: { next: NextAction }) {
  const shortcuts: { label: string; href: string }[] = [
    { label: "Feed", href: "/feed" },
    { label: "Ideas", href: "/ideas" },
    { label: "Channels", href: "/channels" },
  ];

  return (
    <section className="flex flex-col gap-4 border border-border p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <span data-lab className="font-mono text-2xs text-muted-foreground">
          Next
        </span>
        <p className="text-sm text-foreground">{next.reason}</p>
      </div>
      <div className="flex items-center gap-4">
        <nav className="hidden items-center gap-4 sm:flex" aria-label="Quick links">
          {shortcuts.map((s) => (
            <Link key={s.href} href={s.href} className="text-xs text-muted-foreground hover:text-foreground">
              {s.label}
            </Link>
          ))}
        </nav>
        <Link href={next.href} className={cn(buttonVariants({ variant: "default" }), "rounded-none")}>
          {next.label}
        </Link>
      </div>
    </section>
  );
}

/**
 * Decide the next action from dashboard state. Pure, so it is unit-testable without
 * rendering. Order of precedence: never-synced or stale data comes first (nothing
 * downstream is trustworthy until a sync has run), then unreviewed new outliers, then the
 * standing "go browse" default.
 */
export function decideNextAction(state: {
  lastSyncMs: number | null;
  nowMs: number;
  newSinceVisit: number;
  stalenessHours?: number;
}): NextAction {
  const stalenessHours = state.stalenessHours ?? 24;
  const staleMs = stalenessHours * 60 * 60 * 1000;

  if (state.lastSyncMs === null) {
    return { label: "Sync your sources", href: "/channels", reason: "Your sources have never been synced. Pull fresh data to start." };
  }
  const ageMs = state.nowMs - state.lastSyncMs;
  if (ageMs > staleMs) {
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    const ageLabel = days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : `${Math.floor(ageMs / (60 * 60 * 1000))} hours`;
    return { label: "Sync your sources", href: "/channels", reason: `Your data is ${ageLabel} old. Sync to refresh outliers.` };
  }
  if (state.newSinceVisit > 0) {
    return {
      label: `Review ${state.newSinceVisit} new outlier${state.newSinceVisit === 1 ? "" : "s"}`,
      href: "/feed",
      reason: `${state.newSinceVisit} new outlier${state.newSinceVisit === 1 ? "" : "s"} since your last visit. Find one worth remixing.`,
    };
  }
  return { label: "Browse outliers", href: "/feed", reason: "Data is fresh. Pick an over-performer to inspect and remix." };
}
