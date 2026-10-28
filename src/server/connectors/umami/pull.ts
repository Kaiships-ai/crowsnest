import { asc, eq, sql } from "drizzle-orm";
import { db, newId, tables } from "@/server/db";
import { SourceDownError, type PullResult } from "@/server/lib/pull-result";
import { countDays, daysBetween, vnDay, vnDayStart, nextDay, type UmamiDay, type UmamiEvent } from "./days";

export interface UmamiAccess {
  url: string;
  apiKey: string;
  websiteId: string;
}

export interface UmamiWebsite {
  id: string;
  name: string;
  domain: string;
}

/** Progress per events page, and Stop between pages. */
export interface UmamiPullControl {
  onPage?: (progress: { done: number; total: number; label: string }) => void;
  shouldStop?: () => boolean;
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

export const UMAMI_KEY_REJECTED = "Umami rejected the key (401). Create a new key and paste it.";
const unreachable = (url: string) => `Cannot reach ${hostOf(url)}. Check that your Umami server is up, then try again.`;
/** Thrown on a stop between pages; never leaves pullUmami. */
const STOPPED = "you stopped the pull";

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
/** The address as typed, without a trailing slash; one typed with no scheme means https. */
export const umamiBase = (url: string): string => {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

async function getJson<T>(url: string, apiKey: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json", authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw err instanceof Error && err.name === "TimeoutError" ? new Error(`${hostOf(url)} did not answer within 30 seconds. Try again later.`) : new SourceDownError(unreachable(url));
  }
  if (res.status === 401) throw new Error(UMAMI_KEY_REJECTED);
  if (!res.ok) throw new Error(`Umami answered HTTP ${res.status} on ${new URL(url).pathname}`);
  // SAFETY: the callers name the Umami response shape they read; a missing field fails their own check.
  return (await res.json()) as T;
}

type Listing<T> = T[] | { data?: T[] };
const rowsOf = <T>(body: Listing<T>): T[] => (Array.isArray(body) ? body : (body.data ?? []));

/** Every website the key can read: its own, and each of its teams'. An admin's own list can be empty while a team holds the site. */
export async function listUmamiWebsites(url: string, apiKey: string): Promise<UmamiWebsite[]> {
  const root = umamiBase(url);
  const [own, teams] = await Promise.all([getJson<Listing<UmamiWebsite>>(`${root}/api/websites?pageSize=200`, apiKey), getJson<Listing<{ id: string }>>(`${root}/api/teams?pageSize=200`, apiKey)]);
  const teamLists = await Promise.all(rowsOf(teams).map((t) => getJson<Listing<UmamiWebsite>>(`${root}/api/teams/${encodeURIComponent(t.id)}/websites?pageSize=200`, apiKey)));
  const byId = new Map([own, ...teamLists].flatMap(rowsOf).map((w) => [w.id, { id: w.id, name: w.name, domain: w.domain }]));
  return [...byId.values()];
}

export async function checkUmami(access: UmamiAccess): Promise<UmamiWebsite> {
  const website = (await listUmamiWebsites(access.url, access.apiKey)).find((w) => w.id === access.websiteId);
  if (!website) throw new Error("This key cannot read the saved website. Connect Umami again and pick a website.");
  return website;
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

const windowLabel = (days: string[]) => (days.length === 1 ? "events, today" : `events, last ${days.length} days`);

/** Pulls every event from the day before the first open day to now; the day before only seeds each session's campaign and is not counted.
 *  Paging ends once `count` events came back, or at the first empty page when Umami sends no count; past MAX_PAGES the pull is partial.
 *  Only a pull whose every page came back is stored; a stopped, partial or failed pull writes nothing. */
export async function pullUmami(access: UmamiAccess, now: Date, control: UmamiPullControl = {}): Promise<PullResult<UmamiPull, string | SourceDownError>> {
  const days = daysBetween(firstDay(now), vnDay(now));
  const startAt = vnDayStart(days[0]).getTime() - 86_400_000;
  const endAt = now.getTime();
  const label = windowLabel(days);
  const events: UmamiEvent[] = [];
  try {
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new Error(`Umami still had events after ${MAX_PAGES} pages`);
      if (page > 1 && control.shouldStop?.()) throw new Error(STOPPED);
      const query = new URLSearchParams({ startAt: String(startAt), endAt: String(endAt), pageSize: String(PAGE_SIZE), page: String(page) });
      const res = await getJson<{ data?: UmamiEvent[]; count?: number; pageSize?: number }>(`${umamiBase(access.url)}/api/websites/${encodeURIComponent(access.websiteId)}/events?${query}`, access.apiKey);
      events.push(...(res.data ?? []));
      const total = res.count === undefined ? page + 1 : Math.max(1, Math.ceil(res.count / (res.pageSize || PAGE_SIZE)));
      control.onPage?.({ done: page, total: Math.max(page, total), label });
      if (!res.data?.length || (res.count !== undefined && events.length >= res.count)) break;
    }
  } catch (err) {
    // A source that did not answer keeps its kind, so the card can offer Change address.
    const reason = err instanceof SourceDownError ? err : err instanceof Error ? err.message : String(err);
    if (events.length === 0) return { kind: "failed", reason };
    return { kind: "partial", rows: { days, events: events.length, keywords: 0 }, missing: `events after the first ${events.length}`, reason };
  }
  const keywords = db.transaction(() => {
    storeDays(countDays(events, days), now);
    return storeKeywordTotals(now);
  });
  return { kind: "complete", rows: { days, events: events.length, keywords } };
}
