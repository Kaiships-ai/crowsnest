/** The fields of one row of Umami's `GET /api/websites/:id/events`. eventType 1 is a pageview, 2 a custom event. */
export interface UmamiEvent {
  sessionId: string;
  createdAt: string;
  urlPath: string | null;
  urlQuery: string | null;
  eventType: number;
  eventName: string | null;
}

const FUNNEL_EVENTS = ["gift_signup", "checkout_click", "purchase"] as const;
type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

type CampaignCounts = { pageviews: number; giftVisits: number } & Record<FunnelEvent, number>;

export interface UmamiDayCounts {
  visitors: number;
  pageviews: number;
  events: Record<string, number>;
  paths: Record<string, number>;
  utmQuery: Record<string, number>;
  byCampaign: Record<string, CampaignCounts>;
}

export interface UmamiDay {
  day: string;
  raw: UmamiDayCounts;
  clean: UmamiDayCounts;
  testSessionsDropped: number;
}

const VN_OFFSET_MS = 7 * 3_600_000;
const GIFT_PAGE_PREFIX = "/get/";

// Whole-token match, as ksa_sync.py: test, r02test, coding-test; not latest, contest, testing.
const TEST_CAMPAIGN = /(^|[-_])(r\d+)?test([-_]|$)/;
const TEST_SOURCES = ["verify"];
const TEST_PATHS = ["/__test-purchase", "/__diag"];

export const vnDay = (at: string | Date): string => new Date(new Date(at).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
export const vnDayStart = (day: string): Date => new Date(`${day}T00:00:00+07:00`);
export const nextDay = (day: string): string => vnDay(new Date(vnDayStart(day).getTime() + 86_400_000));

export function daysBetween(first: string, last: string): string[] {
  const days: string[] = [];
  for (let d = first; d <= last; d = nextDay(d)) days.push(d);
  return days;
}

const pathOf = (e: UmamiEvent) => (e.urlPath ?? "").split("?")[0];

function utm(query: string | null): Record<string, string> {
  const pairs = [...new URLSearchParams((query ?? "").replace(/^\?/, ""))];
  return Object.fromEntries(pairs.flatMap(([k, v]) => (k.toLowerCase().startsWith("utm_") ? [[k.toLowerCase(), v]] : [])));
}

function isTest(e: UmamiEvent): boolean {
  const u = utm(e.urlQuery);
  if (TEST_CAMPAIGN.test((u.utm_campaign ?? "").toLowerCase())) return true;
  if (TEST_SOURCES.includes((u.utm_source ?? "").toLowerCase())) return true;
  return TEST_PATHS.some((p) => pathOf(e).startsWith(p));
}

const bump = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const isFunnelEvent = (name: string | null): name is FunnelEvent => FUNNEL_EVENTS.some((f) => f === name);

function count(events: UmamiEvent[]): UmamiDayCounts {
  const counts: UmamiDayCounts = { visitors: new Set(events.map((e) => e.sessionId)).size, pageviews: 0, events: {}, paths: {}, utmQuery: {}, byCampaign: {} };
  // A session belongs to the first utm_campaign it carried.
  const campaignOf = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const campaign = utm(e.urlQuery).utm_campaign;
    if (campaign && !campaignOf.has(e.sessionId)) campaignOf.set(e.sessionId, campaign.toLowerCase());
  }
  for (const e of events) {
    const campaign = campaignOf.get(e.sessionId);
    const c = campaign ? (counts.byCampaign[campaign] ??= { pageviews: 0, giftVisits: 0, gift_signup: 0, checkout_click: 0, purchase: 0 }) : null;
    if (e.eventType === 1) {
      counts.pageviews += 1;
      bump(counts.paths, pathOf(e));
      const u = utm(e.urlQuery);
      if (Object.keys(u).length > 0) bump(counts.utmQuery, Object.keys(u).sort().map((k) => `${k}=${u[k]}`).join("&"));
      if (c) {
        c.pageviews += 1;
        if (pathOf(e).startsWith(GIFT_PAGE_PREFIX)) c.giftVisits += 1;
      }
    } else if (e.eventType === 2 && e.eventName) {
      bump(counts.events, e.eventName);
      if (c && isFunnelEvent(e.eventName)) c[e.eventName] += 1;
    }
  }
  return counts;
}

/** Splits a pull's events into Asia/Ho_Chi_Minh days and counts each, raw and with every test session dropped. */
export function countDays(events: UmamiEvent[], days: string[]): UmamiDay[] {
  return days.map((day) => {
    const own = events.filter((e) => vnDay(e.createdAt) === day);
    const testSessions = new Set(own.filter(isTest).map((e) => e.sessionId));
    return { day, raw: count(own), clean: count(own.filter((e) => !testSessions.has(e.sessionId))), testSessionsDropped: testSessions.size };
  });
}
