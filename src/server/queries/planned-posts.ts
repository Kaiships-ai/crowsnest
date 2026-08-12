import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { getPostsWithLatestInsights } from "./own-channel";

/**
 * Planned posts and the my-channel calendar (V1 data contracts, contract 6). A
 * planned post is a dated intention to publish, optionally carrying a Script. Nothing
 * in this module ever calls Instagram, schedules a job, or marks anything published on
 * its own — see planned-post-actions.ts's markPlanPublishedAction for the one, hand-
 * driven way `publishedOwnPostId` is ever set.
 */

export type PlannedPostState = "draft" | "scheduled" | "missed";

export interface PlannedPostRow {
  id: string;
  /** "missed" is computed here on every read, never stored — see the schema comment
   *  on plannedPosts.state for why. */
  state: PlannedPostState;
  title: string;
  note: string | null;
  plannedDate: string | null;
  plannedTime: string | null;
  targetLengthSec: number | null;
  /** One of VIDEO_KINDS (src/server/services/video-kind.ts), or null when no kind has
   *  been chosen — see the schema comment on plannedPosts.videoKind. */
  videoKind: string | null;
  scriptId: string | null;
  /** Denormalized so a calendar cell does not join scripts to print a marker. */
  scriptTitle: string | null;
  scriptLengthChars: number | null;
  /** Set when a carried script was deliberately detached. Lets a plan that lost its
   *  script say so instead of rendering like a plan that never had one. */
  scriptDetachedNote: string | null;
  remixSessionId: string | null;
  sourceVideoId: string | null;
  publishedOwnPostId: string | null;
  /**
   * The plan-to-published reconciliation (V1 scope, Wave 1 item 8), computed on every
   * read and never written automatically. Set when this plan is dated, not yet marked
   * published by hand, and an own_posts row exists on the same date — a hint that the
   * plan probably went out, for the calendar to surface a "mark as published?" prompt.
   *
   * Deliberately NOT a write: contract 6 is explicit that nothing sets
   * publishedOwnPostId but a human, via markPlanPublishedAction. A same-date match is
   * a strong signal, not proof — two different videos can post on the same day — so
   * this stays a suggestion the calendar renders, never a silent auto-confirm.
   */
  reconciledOwnPostId: string | null;
}

type PlannedPostSelect = typeof tables.plannedPosts.$inferSelect;

/** Today's date, YYYY-MM-DD, no time component — plannedDate is date-only and the app
 *  runs on one Mac in one place, so there is no time zone conversion to get wrong. */
function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function toRow(
  row: PlannedPostSelect,
  scriptTitle: string | null,
  scriptLengthChars: number | null,
  reconciledOwnPostId: string | null
): PlannedPostRow {
  const today = todayDateOnly();
  const state: PlannedPostState =
    row.state === "scheduled" && row.plannedDate !== null && row.plannedDate < today ? "missed" : (row.state as "draft" | "scheduled");

  return {
    id: row.id,
    state,
    title: row.title,
    note: row.note,
    plannedDate: row.plannedDate,
    plannedTime: row.plannedTime,
    targetLengthSec: row.targetLengthSec,
    videoKind: row.videoKind,
    scriptId: row.scriptId,
    scriptTitle,
    scriptLengthChars,
    scriptDetachedNote: row.scriptDetachedNote,
    remixSessionId: row.remixSessionId,
    sourceVideoId: row.sourceVideoId,
    publishedOwnPostId: row.publishedOwnPostId,
    reconciledOwnPostId: row.publishedOwnPostId ? null : reconciledOwnPostId,
  };
}

/** Plans overlapping `range` (inclusive, plannedDate strings), plus every undated
 *  draft, which belongs to no month and has to appear in the waiting-cuts pool on
 *  every one. Omitting `range` returns every plan, dated or not. */
export async function getPlannedPosts(range?: { from: string; to: string }): Promise<PlannedPostRow[]> {
  const where = range
    ? or(isNull(tables.plannedPosts.plannedDate), and(gte(tables.plannedPosts.plannedDate, range.from), lte(tables.plannedPosts.plannedDate, range.to)))
    : undefined;

  const rows = await db.select().from(tables.plannedPosts).where(where).orderBy(desc(tables.plannedPosts.createdAt));
  if (rows.length === 0) return [];

  const scriptIds = Array.from(new Set(rows.map((r) => r.scriptId).filter((id): id is string => id !== null)));
  const scriptById = new Map<string, { title: string; content: string }>();
  if (scriptIds.length > 0) {
    const scriptRows = await db
      .select({ id: tables.scripts.id, title: tables.scripts.title, content: tables.scripts.content })
      .from(tables.scripts)
      .where(inArray(tables.scripts.id, scriptIds));
    for (const s of scriptRows) scriptById.set(s.id, { title: s.title, content: s.content });
  }

  // Only fetch own_posts when some row could actually need reconciling — an all-draft
  // planner never touches this table.
  const needsReconciliation = rows.some((r) => r.plannedDate !== null && r.publishedOwnPostId === null);
  const ownPostDateMap = new Map<string, string>(); // plannedDate (YYYY-MM-DD) -> first-matching ownPostId
  if (needsReconciliation) {
    const ownPosts = await getPostsWithLatestInsights();
    for (const p of ownPosts) {
      const date = p.postedAt.slice(0, 10);
      if (!ownPostDateMap.has(date)) ownPostDateMap.set(date, p.ownPostId);
    }
  }

  return rows.map((row) => {
    const script = row.scriptId ? scriptById.get(row.scriptId) : undefined;
    const reconciledOwnPostId = row.plannedDate ? (ownPostDateMap.get(row.plannedDate) ?? null) : null;
    return toRow(row, script?.title ?? null, script?.content.length ?? null, reconciledOwnPostId);
  });
}

/** One plan by id, same `PlannedPostRow` shape (script join, computed `state` and
 *  `reconciledOwnPostId`) as `getPlannedPosts` — the studio brief's single-record
 *  counterpart to that list query. Null when no plan has this id. */
export async function getPlannedPostById(id: string): Promise<PlannedPostRow | null> {
  const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id)).limit(1);
  if (!row) return null;

  let scriptTitle: string | null = null;
  let scriptLengthChars: number | null = null;
  if (row.scriptId) {
    const [script] = await db
      .select({ title: tables.scripts.title, content: tables.scripts.content })
      .from(tables.scripts)
      .where(eq(tables.scripts.id, row.scriptId))
      .limit(1);
    if (script) {
      scriptTitle = script.title;
      scriptLengthChars = script.content.length;
    }
  }

  let reconciledOwnPostId: string | null = null;
  if (row.plannedDate !== null && row.publishedOwnPostId === null) {
    const ownPosts = await getPostsWithLatestInsights();
    const match = ownPosts.find((p) => p.postedAt.slice(0, 10) === row.plannedDate);
    reconciledOwnPostId = match?.ownPostId ?? null;
  }

  return toRow(row, scriptTitle, scriptLengthChars, reconciledOwnPostId);
}

export interface CalendarMonth {
  month: string; // "YYYY-MM"
  published: { ownPostId: string; date: string; reach: number | null; title: string | null }[];
  plans: PlannedPostRow[];
  /** Runs of 3 or more elapsed days with nothing published. Future days are never
   *  dead air — nothing was missed yet. */
  deadAir: { from: string; to: string; days: number }[];
  /** Null when contract 1 has no own-channel measurement at all, so the month can say
   *  "no reach measured" rather than printing zeros under every published cell. */
  measuredAt: string | null;
}

const DEAD_AIR_MIN_DAYS = 3;

function daysInMonth(month: string): string[] {
  const [year, mon] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Runs of DEAD_AIR_MIN_DAYS+ consecutive days, each no later than today, with no
 *  publishedDate in `publishedDates`. A run touching a future day is truncated at
 *  today, since a future day cannot be "dead air" yet. */
function computeDeadAir(month: string, publishedDates: Set<string>): CalendarMonth["deadAir"] {
  const today = todayDateOnly();
  const elapsedDays = daysInMonth(month).filter((d) => d <= today);

  const runs: CalendarMonth["deadAir"] = [];
  let runStart: string | null = null;
  let runLength = 0;

  for (let i = 0; i < elapsedDays.length; i++) {
    const day = elapsedDays[i];
    if (publishedDates.has(day)) {
      if (runLength >= DEAD_AIR_MIN_DAYS) runs.push({ from: runStart!, to: elapsedDays[i - 1], days: runLength });
      runStart = null;
      runLength = 0;
      continue;
    }
    if (runStart === null) runStart = day;
    runLength += 1;
  }
  if (runLength >= DEAD_AIR_MIN_DAYS) runs.push({ from: runStart!, to: elapsedDays[elapsedDays.length - 1], days: runLength });

  return runs;
}

/** The calendar's month payload in one call: published cells from own_posts (contract
 *  1), plan cells from planned_posts, and dead air derived from the gaps between
 *  published dates. Dead air is computed, never stored. */
export async function getCalendarMonth(month: string): Promise<CalendarMonth> {
  const from = `${month}-01`;
  const to = daysInMonth(month).at(-1)!;

  const [ownPosts, plans, snapshot] = await Promise.all([
    getPostsWithLatestInsights(),
    getPlannedPosts({ from, to }),
    db.select({ capturedAt: tables.ownAccountSnapshots.capturedAt }).from(tables.ownAccountSnapshots).orderBy(desc(tables.ownAccountSnapshots.capturedAt)).limit(1),
  ]);

  const published = ownPosts
    .filter((p) => p.postedAt.slice(0, 10) >= from && p.postedAt.slice(0, 10) <= to)
    .map((p) => ({ ownPostId: p.ownPostId, date: p.postedAt.slice(0, 10), reach: p.reach, title: p.caption }));

  const publishedDates = new Set(published.map((p) => p.date));

  return {
    month,
    published,
    plans,
    deadAir: computeDeadAir(month, publishedDates),
    measuredAt: snapshot[0]?.capturedAt ?? null,
  };
}

/** Validates a scriptId exists before a plan is allowed to carry it. Exported so
 *  planned-post-actions.ts (create/attach) and remix-actions.ts (delete refusal) share
 *  one lookup instead of two copies of the same select. */
export async function scriptExists(scriptId: string): Promise<boolean> {
  const [row] = await db.select({ id: tables.scripts.id }).from(tables.scripts).where(eq(tables.scripts.id, scriptId)).limit(1);
  return row !== undefined;
}

/** Every planned_posts row that currently carries `scriptId`, for the delete-refusal
 *  message ("naming the plans and their dates") and for remix-actions.ts's
 *  deleteScriptAction guard. */
export async function getPlansCarryingScript(scriptId: string): Promise<{ id: string; title: string; plannedDate: string | null }[]> {
  return db
    .select({ id: tables.plannedPosts.id, title: tables.plannedPosts.title, plannedDate: tables.plannedPosts.plannedDate })
    .from(tables.plannedPosts)
    .where(eq(tables.plannedPosts.scriptId, scriptId));
}
