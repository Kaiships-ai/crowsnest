import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { feedItemColumns, toFeedItem, type FeedItem, type FeedItemRow } from "./feed";

/** The Ideas inbox's two tabs. "inbox" reads `idea.status = 'inbox'`, "shortlist" reads
 *  `idea.status = 'shortlisted'` — see the tab-to-status map below for why the names
 *  don't line up one-to-one with the column value. */
export type IdeaTab = "inbox" | "shortlist";

const TAB_STATUS: Record<IdeaTab, string> = {
  inbox: "inbox",
  shortlist: "shortlisted",
};

/** One row of `idea`, joined to its source post via `feedItemColumns` — the same shared
 *  column shape `getOutlierFeed` and `getSavedPosts` build their own item types from, so
 *  an idea card and a feed card can never disagree about what "score", "views" or
 *  "engagement" mean for the same video. */
export interface IdeaListItem {
  id: string;
  sourceVideoId: string;
  concept: string;
  angle: string;
  status: string;
  notes: string | null;
  scoreAtCreation: number | null;
  remixSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  post: FeedItem;
}

const ideaColumns = {
  id: tables.idea.id,
  sourceVideoId: tables.idea.sourceVideoId,
  concept: tables.idea.concept,
  angle: tables.idea.angle,
  status: tables.idea.status,
  notes: tables.idea.notes,
  scoreAtCreation: tables.idea.scoreAtCreation,
  remixSessionId: tables.idea.remixSessionId,
  createdAt: tables.idea.createdAt,
  updatedAt: tables.idea.updatedAt,
  ...feedItemColumns,
} as const;

type IdeaRow = {
  id: string;
  sourceVideoId: string;
  concept: string;
  angle: string;
  status: string;
  notes: string | null;
  scoreAtCreation: number | null;
  remixSessionId: string | null;
  createdAt: string;
  updatedAt: string;
} & FeedItemRow;

function toIdeaListItem(row: IdeaRow): IdeaListItem {
  const {
    id,
    sourceVideoId,
    concept,
    angle,
    status,
    notes,
    scoreAtCreation,
    remixSessionId,
    createdAt,
    updatedAt,
    ...postRow
  } = row;
  return {
    id,
    sourceVideoId,
    concept,
    angle,
    status,
    notes,
    scoreAtCreation,
    remixSessionId,
    createdAt,
    updatedAt,
    post: toFeedItem(postRow as FeedItemRow),
  };
}

/**
 * Ideas for one tab of the inbox — "inbox" (status `inbox`) or "shortlist" (status
 * `shortlisted`). `scripted`/`discarded` ideas never surface here; discard is soft
 * (idea.status = "discarded", reversible) but that reversal happens off the row itself
 * via `setIdeaStatusAction`, not by this query showing discarded rows anywhere.
 *
 * Ordered by `scoreAtCreation` desc — SQLite sorts NULLs last under DESC (same fact
 * `feed.ts`'s `buildOrderBy` relies on for `outlierScore`), so an idea generated for a
 * video that had no score yet still sorts to the bottom rather than disappearing.
 */
export async function listIdeas({ tab }: { tab: IdeaTab }): Promise<IdeaListItem[]> {
  const rows = await db
    .select(ideaColumns)
    .from(tables.idea)
    .innerJoin(tables.videos, eq(tables.idea.sourceVideoId, tables.videos.id))
    .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .where(eq(tables.idea.status, TAB_STATUS[tab]))
    .orderBy(desc(tables.idea.scoreAtCreation));

  return rows.map(toIdeaListItem);
}

/** A single idea by id, with its source post — regardless of status, so the detail pane
 *  can still resolve an idea right after it's discarded (reversible) without the row
 *  vanishing out from under an open panel. Null when the id doesn't exist. */
export async function getIdea(id: string): Promise<IdeaListItem | null> {
  const [row] = await db
    .select(ideaColumns)
    .from(tables.idea)
    .innerJoin(tables.videos, eq(tables.idea.sourceVideoId, tables.videos.id))
    .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .where(eq(tables.idea.id, id))
    .limit(1);

  return row ? toIdeaListItem(row) : null;
}

/** The single non-discarded idea for one video, or null. Mirrors `generateIdea`'s own
 *  "at most one active idea per source video" read (`services/ideas.ts`, backed by the
 *  partial unique index `idea_source_active`) — used by the video detail page (B-12) so
 *  its Generate-idea control can reflect that an idea already exists instead of
 *  offering a blind re-generate. */
export async function getIdeaBySourceVideoId(videoId: string): Promise<{ id: string; status: string } | null> {
  const [row] = await db
    .select({ id: tables.idea.id, status: tables.idea.status })
    .from(tables.idea)
    .where(and(eq(tables.idea.sourceVideoId, videoId), ne(tables.idea.status, "discarded")))
    .limit(1);
  return row ?? null;
}

/** How many ideas sit in the inbox right now — backs the Ideas nav item's count badge
 *  (neutral, never amber — DESIGN-SYSTEM.md §3 bans amber on a sidebar count badge). */
export async function countInboxIdeas(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tables.idea)
    .where(eq(tables.idea.status, "inbox"));
  return row?.count ?? 0;
}
