"use client";

/**
 * The planner's month view (v1-scope.md §1 "Planner", the ruling Kai made himself:
 * draft/scheduled/missed, dated, optionally carrying a script; nothing publishes,
 * nothing reminds, marking a plan published is his hand alone). This is the one part of
 * "My channel" the brief calls out as mattering most, so every rule below is load
 * bearing, not decoration:
 *
 * - "missed" is never set by this component. It arrives already computed on
 *   `PlannedPostRow.state` (queries/planned-posts.ts derives it on every read from
 *   today's date vs `plannedDate`) — there is no click anywhere here that could mark a
 *   day missed, because that would make it a lie the next time reality changed.
 * - Reconciliation is read-only. `reconciledOwnPostId` is a suggestion the query already
 *   computed from a same-date match; the only write this component ever makes toward
 *   marking something published is `markPlanPublishedAction`, and only from an explicit
 *   click naming exactly what will happen.
 * - "published" and "dead air" cells depend on `calendar.measuredAt` — a channel that
 *   has never been through a single Graph measurement has no own_posts rows at all, so
 *   an empty month here would otherwise read as "nothing happened" when the honest
 *   reading is "nothing has been checked". Both states stay off until a measurement
 *   exists; scheduled/missed/open still render, since those come from planned_posts,
 *   which needs no Graph connection at all.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  cancelScheduledPublishAction,
  createPlannedPostAction,
  deletePlannedPostAction,
  markPlanPublishedAction,
  retryFailedPublishAction,
} from "@/server/actions/planned-post-actions";
import type { CalendarMonth, PlannedPostRow } from "@/server/queries/planned-posts";
import { ConfirmDialog } from "./confirm-dialog";
import { PlanDialog, type ScriptOption } from "./plan-dialog";
import { PublishDialog } from "./publish-dialog";

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Below this the viewport is too narrow for a side panel to leave the grid usable, so
 *  the detail comes up from the bottom instead. */
export const NARROW_VIEWPORT = "(max-width: 639px)";

/** Which edge the day detail slides in from. Pulled out of the component so the rule is
 *  testable without a DOM: the panel itself lives in a portal, which `renderToStaticMarkup`
 *  (this repo's only rendering path in tests) never emits. */
export function detailPanelSide(narrow: boolean): "right" | "bottom" {
  return narrow ? "bottom" : "right";
}

/** Subscribed, not read once: a rotate or a window resize should move the panel, and
 *  unlike the drag animation in kanban-board.tsx this decides layout, not a flourish.
 *  Starts false so the server render and the first client render agree on side="right". */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_VIEWPORT);
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return narrow;
}

type CellKind = "published" | "publishing" | "failed" | "scheduled" | "missed" | "deadAir" | "open";

/** Mirrors DEFAULT_MAX_ATTEMPTS in publish-scheduler.ts — kept as a plain literal here
 *  rather than imported, so this client component never pulls the server-only scheduler
 *  (db, publish-post) into the browser bundle. The scheduler still owns the real guard:
 *  retryFailedPublishAction refuses an over-cap retry regardless of what the UI shows. */
const MAX_PUBLISH_ATTEMPTS = 3;

interface DayCell {
  key: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
  kind: CellKind;
  reach: number | null;
  title: string | null;
  plan: PlannedPostRow | null;
}

function parseMonth(month: string): { year: number; mon: number } {
  const [y, m] = month.split("-").map(Number);
  return { year: y, mon: m - 1 };
}

function shiftMonth(month: string, delta: number): string {
  const { year, mon } = parseMonth(month);
  const d = new Date(Date.UTC(year, mon + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildGrid(month: string, calendar: CalendarMonth): DayCell[][] {
  const { year, mon } = parseMonth(month);
  const firstWeekday = (new Date(Date.UTC(year, mon, 1)).getUTCDay() + 6) % 7; // Monday=0
  const daysInMonth = new Date(Date.UTC(year, mon + 1, 0)).getUTCDate();
  const totalCells = firstWeekday + daysInMonth;
  const weeks = Math.ceil(totalCells / 7);
  const gridStartMs = Date.UTC(year, mon, 1 - firstWeekday);

  const publishedByDate = new Map(calendar.published.map((p) => [p.date, p]));
  const planByDate = new Map(calendar.plans.filter((p) => p.plannedDate !== null).map((p) => [p.plannedDate as string, p]));
  const hasMeasurement = calendar.measuredAt !== null;

  function inDeadAir(key: string): boolean {
    return calendar.deadAir.some((r) => key >= r.from && key <= r.to);
  }

  const rows: DayCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const cells: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(gridStartMs + (w * 7 + d) * 86_400_000);
      const key = cellDate.toISOString().slice(0, 10);
      const published = hasMeasurement ? publishedByDate.get(key) : undefined;
      const plan = planByDate.get(key) ?? null;

      let kind: CellKind = "open";
      if (published) kind = "published";
      else if (plan?.state === "published") kind = "published"; // hand-marked published, no measured own post yet
      else if (plan?.state === "publishing") kind = "publishing";
      else if (plan?.state === "failed") kind = "failed";
      else if (plan?.state === "missed") kind = "missed";
      else if (plan?.state === "scheduled") kind = "scheduled";
      else if (hasMeasurement && inDeadAir(key)) kind = "deadAir";

      cells.push({
        key,
        day: cellDate.getUTCDate(),
        inMonth: cellDate.getUTCMonth() === mon,
        kind,
        reach: published?.reach ?? null,
        title: published?.title ?? plan?.title ?? null,
        plan,
      });
    }
    rows.push(cells);
  }
  return rows;
}

const CELL_STYLE: Record<CellKind, string> = {
  published: "border-line-strong bg-card",
  publishing: "border-line-strong bg-card",
  failed: "border-destructive/40 bg-destructive/10",
  scheduled: "border-border bg-transparent",
  missed: "border-destructive/40 bg-destructive/10",
  deadAir: "border-border bg-destructive/5",
  open: "border-border",
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MineCalendar({
  month,
  calendar,
  scripts,
  graphConfigured,
  bucketConfigured,
  dryRun,
}: {
  month: string;
  calendar: CalendarMonth;
  scripts: ScriptOption[];
  /** Whether IG_GRAPH_TOKEN/USER_ID are set — the publish dialog needs it to offer a
   *  real publish rather than a fabricated one. */
  graphConfigured: boolean;
  /** Whether the S3_* storage bucket is configured. Same honesty rule as the token. */
  bucketConfigured: boolean;
  /** Whether the publish path skips its final POST (PUBLISH_DRY_RUN / non-prod default). */
  dryRun: boolean;
}) {
  const router = useRouter();
  const grid = useMemo(() => buildGrid(month, calendar), [month, calendar]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<{ mode: "create" | "edit"; date?: string; plan?: PlannedPostRow } | null>(null);
  const [publishPlan, setPublishPlan] = useState<PlannedPostRow | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "cancel" | "delete"; plan: PlannedPostRow } | null>(null);

  const today = todayKey();
  const undatedDrafts = calendar.plans.filter((p) => p.plannedDate === null);
  const selectedCell = selectedKey ? grid.flat().find((c) => c.key === selectedKey) ?? null : null;
  const narrow = useNarrowViewport();

  async function reconcile(plan: PlannedPostRow) {
    if (!plan.reconciledOwnPostId) return;
    const result = await markPlanPublishedAction(plan.id, plan.reconciledOwnPostId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Marked published");
    router.refresh();
  }

  async function markPublishedNoLink(plan: PlannedPostRow) {
    const result = await markPlanPublishedAction(plan.id, null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Marked published, no post linked");
    router.refresh();
  }

  async function cancelScheduled(plan: PlannedPostRow) {
    const result = await cancelScheduledPublishAction(plan.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Publish cancelled");
    router.refresh();
  }

  async function retry(plan: PlannedPostRow) {
    const result = await retryFailedPublishAction(plan.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Re-armed for another attempt");
    router.refresh();
  }

  async function remove(plan: PlannedPostRow) {
    const result = await deletePlannedPostAction(plan.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setSelectedKey(null);
    router.refresh();
    toast.success("Planned post deleted", {
      action: {
        label: "Undo",
        onClick: async () => {
          const restored = await createPlannedPostAction({
            title: plan.title,
            note: plan.note ?? undefined,
            plannedDate: plan.plannedDate ?? undefined,
            scriptId: plan.scriptId ?? undefined,
          });
          if (!restored.ok) {
            toast.error(restored.error);
            return;
          }
          router.refresh();
        },
      },
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`?month=${shiftMonth(month, -1)}`} aria-label="Previous month" className="rounded p-1.5 text-muted-foreground hover:bg-popover hover:text-foreground">
            ‹
          </Link>
          <h3 className="min-w-[11ch] text-lg font-semibold tracking-tight">
            {MONTH_LABELS[parseMonth(month).mon]} {parseMonth(month).year}
          </h3>
          <Link href={`?month=${shiftMonth(month, 1)}`} aria-label="Next month" className="rounded p-1.5 text-muted-foreground hover:bg-popover hover:text-foreground">
            ›
          </Link>
          <Link href={`?month=${today.slice(0, 7)}`} className="text-sm text-muted-foreground hover:text-foreground">
            Today
          </Link>
        </div>
        <Button size="sm" onClick={() => setDialogState({ mode: "create" })}>
          New planned post
        </Button>
      </div>

      {calendar.measuredAt === null && (
        <p className="mt-4 max-w-[62ch] text-sm text-muted-foreground">
          No own-channel measurement yet, so this month can&apos;t show what actually published or where the
          gaps are, only your own plans, below. Connect the Graph API to fill in the rest.
        </p>
      )}

      <div className="mt-7 overflow-x-auto pb-2">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 gap-2 border-b border-line-strong pb-3 font-mono text-2xs text-faint">
            {WEEKDAY_LABELS.map((d) => (
              <span key={d} data-lab>
                {d}
              </span>
            ))}
          </div>
          {grid.map((row, i) => (
            <div key={i} className="mt-2 grid grid-cols-7 gap-2">
              {row.map((cell) => (
                <button
                  key={cell.key}
                  type="button"
                  data-testid="mine-calendar-day"
                  data-id={cell.key}
                  onClick={() => setSelectedKey(cell.key)}
                  aria-pressed={selectedKey === cell.key}
                  className={cn(
                    "relative flex min-h-[76px] flex-col gap-1.5 border p-2 text-left",
                    CELL_STYLE[cell.kind],
                    !cell.inMonth && "opacity-40",
                    selectedKey === cell.key && "ring-1 ring-foreground/40"
                  )}
                >
                  {cell.plan?.publishedOwnPostId != null && (
                    <span aria-hidden className="absolute right-1.5 top-1.5 size-2 bg-pos" />
                  )}
                  <span className="flex w-full items-baseline gap-1.5">
                    <span data-num className="font-mono text-2xs text-faint">
                      {cell.day}
                    </span>
                    {cell.key === today && <span className="font-mono text-2xs text-muted-foreground">today</span>}
                  </span>
                  {cell.kind === "published" && (
                    <span data-num className="font-mono text-sm text-foreground">
                      {cell.reach === null ? "—" : cell.reach.toLocaleString("en-US")}
                    </span>
                  )}
                  {cell.kind === "missed" && <span className="font-mono text-2xs text-destructive">missed</span>}
                  {cell.kind === "scheduled" && (
                    <span className="font-mono text-2xs text-muted-foreground" data-testid="mine-calendar-scheduled">
                      scheduled
                    </span>
                  )}
                  {cell.kind === "publishing" && (
                    <span className="animate-pulse font-mono text-2xs text-muted-foreground" data-testid="mine-calendar-publishing">
                      PUBLISHING
                    </span>
                  )}
                  {cell.kind === "failed" && (
                    <span className="font-mono text-2xs text-destructive" data-testid="mine-calendar-failed">
                      failed{cell.plan?.errorClass ? ` · ${cell.plan.errorClass}` : ""}
                    </span>
                  )}
                  {cell.plan?.state === "published" && (
                    <span aria-hidden className="font-mono text-2xs text-pos" data-testid="mine-calendar-published">
                      ✓ published
                    </span>
                  )}
                  {cell.title && cell.kind !== "published" && (
                    <span className="line-clamp-2 text-2xs text-muted-foreground">{cell.title}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-2xs text-faint">
        {calendar.measuredAt !== null && (
          <>
            <span className="flex items-center gap-2">
              <i aria-hidden className="size-3 border border-line-strong bg-card" /> published · number is reach
            </span>
            <span className="flex items-center gap-2">
              <i aria-hidden className="size-3 border border-border bg-destructive/5" /> dead air, 3+ days
            </span>
          </>
        )}
        <span className="flex items-center gap-2">
          <i aria-hidden className="size-3 border border-border" /> scheduled
        </span>
        <span className="flex items-center gap-2">
          <i aria-hidden className="size-3 border border-destructive/40 bg-destructive/10" /> missed / failed
        </span>
        <span className="flex items-center gap-2">
          <i aria-hidden className="size-3 border border-line-strong bg-card" /> publishing / published
        </span>
        <span className="flex items-center gap-2">
          <i aria-hidden className="size-3 border border-border" /> open
        </span>
        <span className="flex items-center gap-2">
          <i aria-hidden className="size-2 bg-pos" /> plan published
        </span>
      </div>

      {/* The day detail slides in beside the grid rather than pushing it down the page, so
          the month stays visible and the selected cell's ring stays the spatial anchor
          for where the panel came from. Escape and click-outside close come from the
          Sheet; there is no hand-rolled close button any more. Under 640px there is no
          room beside the grid, so it comes up from the bottom. */}
      <Sheet open={selectedCell !== null} onOpenChange={(open) => !open && setSelectedKey(null)}>
        <SheetContent
          side={detailPanelSide(narrow)}
          // The base transition is transform plus opacity over 200ms. Under reduced
          // motion the translate is pinned to 0 so the panel fades rather than travels.
          className="motion-reduce:data-[side=bottom]:data-ending-style:translate-y-0 motion-reduce:data-[side=bottom]:data-starting-style:translate-y-0 motion-reduce:data-[side=right]:data-ending-style:translate-x-0 motion-reduce:data-[side=right]:data-starting-style:translate-x-0"
        >
          {selectedCell && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
            <SheetHeader className="p-0">
              <p className="font-mono text-2xs tracking-wide text-faint">{selectedCell.key}</p>
              <SheetTitle className="mt-1 text-lg font-medium text-foreground">
                {selectedCell.title ?? (selectedCell.kind === "open" ? "Nothing planned" : "—")}
              </SheetTitle>
            </SheetHeader>

            {selectedCell.kind === "published" && (
              <p className="font-mono text-sm text-muted-foreground">
                Reach {selectedCell.reach === null ? "—" : selectedCell.reach.toLocaleString("en-US")}
              </p>
            )}

            {selectedCell.plan && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <p className="font-mono text-2xs tracking-wide text-faint uppercase">
                  {selectedCell.plan.state}
                  {selectedCell.plan.scriptId === null && !selectedCell.plan.remixSessionId && " · no script yet"}
                  {selectedCell.plan.publishedOwnPostId !== null && <span className="text-pos"> · published</span>}
                </p>
                {selectedCell.plan.scriptDetachedNote && (
                  <p className="text-xs text-destructive">{selectedCell.plan.scriptDetachedNote}</p>
                )}
                {selectedCell.plan.note && <p className="text-sm text-muted-foreground">{selectedCell.plan.note}</p>}
                {selectedCell.plan.scriptId && (
                  <p className="text-xs text-muted-foreground">
                    Script: {selectedCell.plan.scriptTitle ?? "—"}
                    {selectedCell.plan.sourceVideoId && (
                      <>
                        {" · "}
                        <Link href={`/feed/${selectedCell.plan.sourceVideoId}`} className="underline hover:text-foreground">
                          source outlier
                        </Link>
                      </>
                    )}
                  </p>
                )}

                {selectedCell.plan.reconciledOwnPostId && (
                  <div className="border-l-2 border-border pl-3">
                    <p className="text-sm text-foreground">
                      You posted something on this date. Mark this plan published against it?
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => reconcile(selectedCell.plan!)}>
                        Yes, that&apos;s it
                      </Button>
                    </div>
                  </div>
                )}

                {/* Publish lifecycle — none of this uses amber (The Amber Law): the
                    in-progress mark is neutral, the verdict is green, failure is a red
                    wash. The one amber action lives inside the publish dialog. */}
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  {selectedCell.plan.scheduledAt && selectedCell.plan.state !== "published" && (
                    <p className="font-mono text-2xs tabular-nums text-muted-foreground" data-testid="mine-plan-scheduled-at">
                      publishes {new Date(selectedCell.plan.scheduledAt).toLocaleString("en-US")}
                    </p>
                  )}

                  {selectedCell.plan.state === "publishing" && (
                    <p className="animate-pulse font-mono text-2xs tracking-wide text-muted-foreground" data-testid="mine-plan-publishing">
                      PUBLISHING…
                    </p>
                  )}

                  {selectedCell.plan.state === "failed" && (
                    <div className="border-l-2 border-destructive/40 bg-destructive/10 px-3 py-2" data-testid="mine-plan-failed">
                      <p className="font-mono text-2xs tracking-wide text-destructive">
                        publish failed{selectedCell.plan.errorClass ? ` · ${selectedCell.plan.errorClass}` : ""}
                      </p>
                      {selectedCell.plan.lastError && <p className="mt-1 text-xs text-muted-foreground">{selectedCell.plan.lastError}</p>}
                      {selectedCell.plan.attemptCount < MAX_PUBLISH_ATTEMPTS && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          data-testid="mine-plan-retry"
                          onClick={() => retry(selectedCell.plan!)}
                        >
                          Retry
                        </Button>
                      )}
                    </div>
                  )}

                  {selectedCell.plan.state === "published" && (
                    <p className="font-mono text-2xs text-pos" data-testid="mine-plan-published">
                      ✓ published{selectedCell.plan.dryRun ? " (dry run)" : ""}
                      {selectedCell.plan.publishedOwnPostId && !selectedCell.plan.dryRun && (
                        <>
                          {" · "}
                          <Link href={`/mine/${selectedCell.plan.publishedOwnPostId}`} className="underline hover:text-foreground">
                            view post
                          </Link>
                        </>
                      )}
                    </p>
                  )}

                  {(selectedCell.plan.state === "draft" ||
                    selectedCell.plan.state === "scheduled" ||
                    selectedCell.plan.state === "missed" ||
                    selectedCell.plan.state === "failed") && (
                    <div className="flex flex-wrap items-center gap-4">
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="mine-plan-open-publish"
                        onClick={() => setPublishPlan(selectedCell.plan!)}
                      >
                        {selectedCell.plan.videoAssetId ? "Edit publish" : "Upload & schedule"}
                      </Button>
                      {selectedCell.plan.scheduledAt && (
                        <button
                          type="button"
                          data-testid="mine-plan-cancel-publish"
                          className="font-mono text-2xs text-muted-foreground hover:text-destructive hover:underline active:translate-y-px"
                          onClick={() => setConfirm({ kind: "cancel", plan: selectedCell.plan! })}
                        >
                          cancel scheduled publish
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap gap-4">
                  <button
                    type="button"
                    className="font-mono text-2xs text-muted-foreground hover:text-foreground hover:underline active:translate-y-px"
                    onClick={() => setDialogState({ mode: "edit", plan: selectedCell.plan! })}
                  >
                    edit / reschedule
                  </button>
                  {selectedCell.plan.publishedOwnPostId === null && (
                    <button
                      type="button"
                      data-testid="mine-calendar-mark-published"
                      className="font-mono text-2xs text-muted-foreground hover:text-foreground hover:underline active:translate-y-px"
                      onClick={() => markPublishedNoLink(selectedCell.plan!)}
                    >
                      mark published, no post linked
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="mine-plan-delete"
                    className="font-mono text-2xs text-muted-foreground hover:text-destructive hover:underline active:translate-y-px"
                    onClick={() =>
                      selectedCell.plan!.videoAssetId
                        ? setConfirm({ kind: "delete", plan: selectedCell.plan! })
                        : remove(selectedCell.plan!)
                    }
                  >
                    delete
                  </button>
                </div>
              </div>
            )}

            {!selectedCell.plan && selectedCell.kind !== "published" && (
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                data-testid="mine-calendar-plan-day"
                onClick={() => setDialogState({ mode: "create", date: selectedCell.key })}
              >
                Plan something for this day
              </Button>
            )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {undatedDrafts.length > 0 && (
        <div className="mt-10 border-t border-border pt-6">
          <p className="font-mono text-2xs tracking-wide text-faint uppercase">Undated drafts</p>
          <div className="mt-3 flex flex-col">
            {undatedDrafts.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-4 border-b border-border py-2.5">
                <span className="truncate text-sm text-foreground">{d.title}</span>
                <div className="flex shrink-0 items-center gap-4">
                  <button
                    type="button"
                    className="font-mono text-2xs text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() => setDialogState({ mode: "edit", plan: d })}
                  >
                    give it a date
                  </button>
                  <button
                    type="button"
                    className="font-mono text-2xs text-muted-foreground hover:text-destructive hover:underline"
                    onClick={() => remove(d)}
                  >
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {dialogState && (
        <PlanDialog
          open
          onOpenChange={(next) => !next && setDialogState(null)}
          plan={dialogState.mode === "edit" ? dialogState.plan : undefined}
          presetDate={dialogState.date}
          scripts={scripts}
          onSaved={() => setDialogState(null)}
        />
      )}

      {publishPlan && (
        <PublishDialog
          open
          onOpenChange={(next) => !next && setPublishPlan(null)}
          plan={publishPlan}
          graphConfigured={graphConfigured}
          bucketConfigured={bucketConfigured}
          dryRun={dryRun}
          onDone={() => setPublishPlan(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setConfirm(null)}
          testid={confirm.kind === "cancel" ? "mine-confirm-cancel-publish" : "mine-confirm-delete-plan"}
          title={confirm.kind === "cancel" ? "Cancel this scheduled publish?" : "Delete this plan?"}
          body={
            confirm.kind === "cancel"
              ? "The plan goes back to an undated draft. Its video and caption stay attached."
              : "This plan carries an uploaded video. Deleting it removes the plan for good."
          }
          confirmLabel={confirm.kind === "cancel" ? "Cancel publish" : "Delete plan"}
          onConfirm={() => (confirm.kind === "cancel" ? cancelScheduled(confirm.plan) : remove(confirm.plan))}
        />
      )}
    </div>
  );
}
