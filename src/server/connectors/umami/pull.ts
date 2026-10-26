import { asc, eq, sql } from "drizzle-orm";
import { db, newId, tables } from "@/server/db";
import type { PullResult } from "@/server/lib/pull-result";
import { countDays, daysBetween, vnDay, vnDayStart, nextDay, type UmamiDay, type UmamiEvent } from "./days";

export interface UmamiAccess {
  url: string;
  websiteId: string;
  username: string;
  password: string;
}

export interface UmamiPull {
  days: string[];
  events: number;
  keywords: number;
}

const PAGE_SIZE = 500;
// ponytail: 200k events per pull; a bigger site needs a smaller pull window, not a higher cap.
const MAX_PAGES = 400;
const BACKFILL_CAP_DAYS = 365;

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", ...init.headers }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Umami answered HTTP ${res.status} on ${new URL(url).pathname}`);
  // SAFETY: the callers name the Umami response shape they read; a missing field fails their own check.
  return (await res.json()) as T;
}

async function login(access: UmamiAccess): Promise<string> {
  const { token } = await getJson<{ token?: string }>(`${access.url.replace(/\/+$/, "")}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: access.username, password: access.password }),
  });
  if (!token) throw new Error("Umami login returned no token");
  return token;
}

const site = (access: UmamiAccess) => `${access.url.replace(/\/+$/, "")}/api/websites/${encodeURIComponent(access.websiteId)}`;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function checkUmami(access: UmamiAccess): Promise<void> {
  const token = await login(access);
  const website = await getJson<{ id?: string }>(site(access), { headers: bearer(token) });
  if (website.id !== access.websiteId) throw new Error("Umami has no website with that id");
}

/** The first day to pull: the oldest day not yet final, else the oldest keyword reel's day (at most a year back). */
function firstDay(now: Date): string {
  const open = db.select({ day: tables.umamiDays.day }).from(tables.umamiDays).where(eq(tables.umamiDays.final, 0)).orderBy(asc(tables.umamiDays.day)).limit(1).get();
  if (open) return open.day;
  const newest = db.select({ day: sql<string | null>`max(${tables.umamiDays.day})` }).from(tables.umamiDays).get();
  if (newest?.day) return nextDay(newest.day);
  const oldest = db.get<{ at: string | null }>(sql`SELECT min(coalesce(published_at, created_at)) AS at FROM planned_posts WHERE keyword IS NOT NULL`);
  const cap = vnDay(new Date(now.getTime() - BACKFILL_CAP_DAYS * 86_400_000));
  const from = oldest?.at ? vnDay(oldest.at) : vnDay(now);
  return from < cap ? cap : from;
}

/** Each keyword's lifetime gift-page visits, gift signups and checkout clicks: the sum over every stored day of the sessions that came with utm_campaign = the keyword. */
function storeKeywordTotals(now: Date): number {
  const keywords = db.all<{ keyword: string }>(sql`SELECT keyword FROM planned_posts WHERE keyword IS NOT NULL`);
  const days = db.select({ clean: tables.umamiDays.clean }).from(tables.umamiDays).all();
  const capturedAt = now.toISOString();
  const rows = keywords.flatMap(({ keyword }) => {
    const campaign = keyword.toLowerCase();
    const visits = days.reduce((sum, d) => sum + (d.clean.byCampaign[campaign]?.giftVisits ?? 0), 0);
    const emails = days.reduce((sum, d) => sum + (d.clean.byCampaign[campaign]?.gift_signup ?? 0), 0);
    const checkouts = days.reduce((sum, d) => sum + (d.clean.byCampaign[campaign]?.checkout_click ?? 0), 0);
    return [
      { id: newId(), keyword, source: "umami" as const, metric: "visits", value: visits, capturedAt, agent: "umami", createdAt: capturedAt },
      { id: newId(), keyword, source: "umami" as const, metric: "emails", value: emails, capturedAt, agent: "umami", createdAt: capturedAt },
      { id: newId(), keyword, source: "umami" as const, metric: "checkouts", value: checkouts, capturedAt, agent: "umami", createdAt: capturedAt },
    ];
  });
  if (rows.length > 0) db.insert(tables.reelFunnel).values(rows).run();
  return keywords.length;
}

function storeDays(days: UmamiDay[], now: Date): void {
  const fetchedAt = now.toISOString();
  for (const d of days) {
    const final = now.getTime() >= vnDayStart(nextDay(d.day)).getTime() ? 1 : 0;
    const row = { raw: d.raw, clean: d.clean, testSessionsDropped: d.testSessionsDropped, final, fetchedAt };
    db.insert(tables.umamiDays).values({ day: d.day, ...row }).onConflictDoUpdate({ target: tables.umamiDays.day, set: row }).run();
  }
}

/** Pulls every event from the day before the first open day to now; the day before only seeds each session's campaign and is not counted. Paging stops at the first empty page; past MAX_PAGES the pull is partial. Only a pull whose every page came back is stored; a partial or failed pull writes nothing. */
export async function pullUmami(access: UmamiAccess, now: Date): Promise<PullResult<UmamiPull>> {
  const days = daysBetween(firstDay(now), vnDay(now));
  const startAt = vnDayStart(days[0]).getTime() - 86_400_000;
  const endAt = now.getTime();
  const events: UmamiEvent[] = [];
  try {
    const token = await login(access);
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new Error(`Umami still had events after ${MAX_PAGES} pages`);
      const query = new URLSearchParams({ startAt: String(startAt), endAt: String(endAt), pageSize: String(PAGE_SIZE), page: String(page) });
      const res = await getJson<{ data?: UmamiEvent[] }>(`${site(access)}/events?${query}`, { headers: bearer(token) });
      events.push(...(res.data ?? []));
      if (!res.data?.length) break;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (events.length === 0) return { kind: "failed", reason };
    return { kind: "partial", rows: { days, events: events.length, keywords: 0 }, missing: `events after the first ${events.length}`, reason };
  }
  const keywords = db.transaction(() => {
    storeDays(countDays(events, days), now);
    return storeKeywordTotals(now);
  });
  return { kind: "complete", rows: { days, events: events.length, keywords } };
}
