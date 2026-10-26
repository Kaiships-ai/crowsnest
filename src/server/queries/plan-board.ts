import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";

import { db, tables } from "@/server/db";
import { clockNow } from "@/server/lib/clock";

export type PlanCardState = "draft" | "plan" | "missed" | "cooking" | "scheduled" | "publishing" | "published" | "failed";
export type PlanItem = "script" | "caption" | "reference" | "time" | "key" | "gift" | "offer";

const ALWAYS_MISSING: PlanItem[] = ["key", "gift", "offer"];

export interface PlanCard {
  id: string;
  title: string;
  state: PlanCardState;
  date: string;
  time: string | null;
  script: { title: string; content: string } | null;
  caption: string | null;
  reference: { videoId: string; url: string; handle: string } | null;
  missing: PlanItem[];
  lockReason: string | null;
  cookWorkspaceId: string | null;
}

export interface PlanDay {
  date: string;
  inMonth: boolean;
  cards: PlanCard[];
}

export interface PlanBoard {
  month: string;
  today: string;
  gridDays: PlanDay[];
}

type PlanRow = typeof tables.plannedPosts.$inferSelect;

const ymd = (d: Date) => d.toLocaleDateString("sv-SE");

const LOCK_REASONS: Partial<Record<PlanCardState, string>> = {
  scheduled: "Scheduled on Instagram. Unschedule it before you move its day.",
  publishing: "This reel is publishing to Instagram.",
  published: "This reel is published.",
  failed: "The last publish failed. Fix it before you move its day.",
};

export function planCardState(row: Pick<PlanRow, "state" | "scheduledAt" | "plannedDate" | "cookWorkspaceId">, today: string): PlanCardState {
  if (row.state === "publishing" || row.state === "published" || row.state === "failed") return row.state;
  if (row.scheduledAt) return "scheduled";
  if (row.cookWorkspaceId) return "cooking";
  if (row.state === "draft") return "draft";
  return row.plannedDate !== null && row.plannedDate < today ? "missed" : "plan";
}

export function planLockReason(state: PlanCardState): string | null {
  return LOCK_REASONS[state] ?? null;
}

function monthGrid(month: string): { date: string; inMonth: boolean }[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7));
  const end = new Date(y, m - 1, last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const days: { date: string; inMonth: boolean }[] = [];
  for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    days.push({ date: ymd(d), inMonth: d.getMonth() === m - 1 });
  }
  return days;
}

export async function getPlanBoard(month: string, now = clockNow()): Promise<PlanBoard> {
  const today = ymd(now);
  const grid = monthGrid(month);
  const from = grid[0].date;
  const to = grid[grid.length - 1].date;
  const rows = await db
    .select()
    .from(tables.plannedPosts)
    .where(and(isNotNull(tables.plannedPosts.plannedDate), gte(tables.plannedPosts.plannedDate, from), lte(tables.plannedPosts.plannedDate, to)))
    .orderBy(tables.plannedPosts.plannedDate, tables.plannedPosts.plannedTime, tables.plannedPosts.createdAt);

  const scriptIds = [...new Set(rows.flatMap((r) => (r.scriptId ? [r.scriptId] : [])))];
  const videoIds = [...new Set(rows.flatMap((r) => (r.sourceVideoId ? [r.sourceVideoId] : [])))];
  const scripts = scriptIds.length
    ? await db.select({ id: tables.scripts.id, title: tables.scripts.title, content: tables.scripts.content }).from(tables.scripts).where(inArray(tables.scripts.id, scriptIds))
    : [];
  const videos = videoIds.length
    ? await db
        .select({ videoId: tables.videos.id, url: tables.videos.url, handle: tables.channels.handle })
        .from(tables.videos)
        .innerJoin(tables.channels, eq(tables.channels.id, tables.videos.channelId))
        .where(inArray(tables.videos.id, videoIds))
    : [];
  const scriptById = new Map(scripts.map(({ id, ...s }) => [id, s]));
  const videoById = new Map(videos.map((v) => [v.videoId, v]));

  const cards = rows.map((row): PlanCard => {
    const state = planCardState(row, today);
    const script = (row.scriptId && scriptById.get(row.scriptId)) || null;
    const reference = (row.sourceVideoId && videoById.get(row.sourceVideoId)) || null;
    const caption = row.caption?.trim() ? row.caption : null;
    const checks: [PlanItem, boolean][] = [["script", script !== null], ["caption", caption !== null], ["reference", reference !== null], ["time", row.plannedTime !== null]];
    return {
      id: row.id,
      title: row.title,
      state,
      date: row.plannedDate!,
      time: row.plannedTime,
      script,
      caption,
      reference,
      missing: [...checks.filter(([, ok]) => !ok).map(([item]) => item), ...ALWAYS_MISSING],
      lockReason: planLockReason(state),
      cookWorkspaceId: row.cookWorkspaceId,
    };
  });

  return {
    month,
    today,
    gridDays: grid.map((d) => ({ ...d, cards: cards.filter((c) => c.date === d.date) })),
  };
}
