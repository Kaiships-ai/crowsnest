import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { getFunnelBoard } from "@/server/queries/funnel-board";
import { saveUmamiKeyAction } from "@/server/actions/umami-actions";
import { SourceDownError } from "@/server/lib/pull-result";
import { getSecret, setSecret } from "@/server/secrets/store";
import { getFunnelTotals } from "@/server/services/funnel";
import { getSecretStore, setSecretStore } from "../../../shared/secret-store";
import { getFunnel } from "@/server/services/funnel";
import type { UmamiEvent } from "./days";
import { connector } from "./index";
import { listUmamiWebsites, pullUmami, UMAMI_KEY_REJECTED, type UmamiAccess } from "./pull";

const pv = (sessionId: string, createdAt: string, url: string): UmamiEvent => {
  const [urlPath, urlQuery = null] = url.split("?");
  return { sessionId, createdAt, urlPath, urlQuery, eventType: 1, eventName: null };
};
const ev = (sessionId: string, createdAt: string, urlPath: string, eventName: string): UmamiEvent => ({ sessionId, createdAt, urlPath, urlQuery: null, eventType: 2, eventName });

const EVENTS: UmamiEvent[] = [
  pv("s1", "2026-10-17T01:00:00.000Z", "/get/shark?utm_campaign=shark&utm_source=ig_dm"),
  pv("s1", "2026-10-17T01:01:00.000Z", "/free/shark.html"),
  ev("s1", "2026-10-17T01:02:00.000Z", "/get/shark", "gift_signup"),
  pv("s2", "2026-10-17T02:00:00.000Z", "/get/coding"),
  pv("s3", "2026-10-17T03:00:00.000Z", "/get/shark?utm_campaign=r02test"),
  ev("s3", "2026-10-17T03:01:00.000Z", "/get/shark", "gift_signup"),
  pv("s6", "2026-10-17T18:00:00.000Z", "/get/shark?utm_campaign=shark"),
  pv("s4", "2026-10-18T02:00:00.000Z", "/get/coding?utm_campaign=coding"),
  pv("s4", "2026-10-18T02:05:00.000Z", "/get/coding?utm_campaign=coding"),
  ev("s4", "2026-10-18T02:06:00.000Z", "/get/coding", "gift_signup"),
  pv("s5", "2026-10-18T03:00:00.000Z", "/get/shark?utm_campaign=SHARK"),
];

const NOW = new Date("2026-10-18T10:00:00.000Z");
const fake = { failPage: 0, eventCalls: [] as URLSearchParams[], authHeaders: [] as (string | undefined)[], events: EVENTS, pageSize: 4, sendCount: true, ignorePage: false, emptyPage: 0 };
let server: Server;
let access: UmamiAccess;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    fake.authHeaders.push(req.headers.authorization);
    if (req.headers.authorization !== "Bearer key-1") return send(401, { error: "Unauthorized" });
    if (url.pathname === "/api/websites") return send(200, { data: [], count: 0, page: 1, pageSize: 200 });
    if (url.pathname === "/api/teams") return send(200, { data: [{ id: "team-1", name: "kaiships" }], count: 1, page: 1, pageSize: 200 });
    if (url.pathname === "/api/teams/team-1/websites") return send(200, { data: [{ id: "site-1", name: "kaiships", domain: "kai-ships-ai-website.vercel.app" }], count: 1 });
    if (url.pathname === "/api/websites/site-1/events") {
      fake.eventCalls.push(url.searchParams);
      const page = Number(url.searchParams.get("page"));
      if (page === fake.failPage) return send(503, { error: "busy" });
      const from = Number(url.searchParams.get("startAt"));
      const to = Number(url.searchParams.get("endAt"));
      const inRange = fake.events.filter((e) => Date.parse(e.createdAt) >= from && Date.parse(e.createdAt) <= to);
      const data = page === fake.emptyPage ? [] : fake.ignorePage ? inRange.slice(0, fake.pageSize) : inRange.slice((page - 1) * fake.pageSize, page * fake.pageSize);
      return send(200, fake.sendCount ? { data, count: inRange.length, page, pageSize: fake.pageSize } : { data, page, pageSize: fake.pageSize });
    }
    send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  access = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, apiKey: "key-1", websiteId: "site-1" };
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  migrate();
  for (const t of [tables.umamiDays, tables.reelFunnel, tables.plannedPosts, tables.sealedSecrets, tables.secrets]) await db.delete(t);
  Object.assign(fake, { failPage: 0, eventCalls: [], authHeaders: [], events: EVENTS, pageSize: 4, sendCount: true, ignorePage: false, emptyPage: 0 });
  const at = "2026-10-17T00:30:00.000Z";
  await db.insert(tables.plannedPosts).values([
    { id: "plan-shark", state: "published", title: "Shark reel", keyword: "SHARK", createdAt: at, updatedAt: at },
    { id: "plan-coding", state: "published", title: "Coding reel", keyword: "CODING", createdAt: at, updatedAt: at },
  ]);
});

const funnelRows = () =>
  db
    .select({ keyword: tables.reelFunnel.keyword, source: tables.reelFunnel.source, metric: tables.reelFunnel.metric, value: tables.reelFunnel.value, capturedAt: tables.reelFunnel.capturedAt })
    .from(tables.reelFunnel)
    .orderBy(tables.reelFunnel.keyword, tables.reelFunnel.metric, tables.reelFunnel.capturedAt)
    .all();

describe("Umami pull", () => {
  test("stores each VN day, raw and without test sessions, and each keyword's lifetime gift-page visits and signups", async () => {
    expect(await pullUmami(access, NOW)).toEqual({ kind: "complete", rows: { days: ["2026-10-17", "2026-10-18"], events: 11, keywords: 2 } });
    expect(fake.eventCalls.map((q) => q.get("page"))).toEqual(["1", "2", "3"]);
    expect(fake.authHeaders).toEqual(["Bearer key-1", "Bearer key-1", "Bearer key-1"]);
    expect(fake.eventCalls[0].get("startAt")).toBe(String(Date.parse("2026-10-15T17:00:00.000Z")));

    const days = db.select().from(tables.umamiDays).orderBy(tables.umamiDays.day).all();
    expect(days.map((d) => [d.day, d.final, d.testSessionsDropped, d.raw.visitors, d.clean.visitors])).toEqual([
      ["2026-10-17", 1, 1, 3, 2],
      ["2026-10-18", 0, 0, 3, 3],
    ]);
    expect(days[0].clean).toEqual({
      visitors: 2,
      pageviews: 3,
      events: { gift_signup: 1 },
      paths: { "/get/shark": 1, "/free/shark.html": 1, "/get/coding": 1 },
      utmQuery: { "utm_campaign=shark&utm_source=ig_dm": 1 },
      byCampaign: { shark: { pageviews: 2, giftVisits: 1, gift_signup: 1, checkout_click: 0, purchase: 0 } },
    });
    expect(days[0].raw.byCampaign.r02test).toEqual({ pageviews: 1, giftVisits: 1, gift_signup: 1, checkout_click: 0, purchase: 0 });

    const at = NOW.toISOString();
    expect(funnelRows()).toEqual([
      { keyword: "CODING", source: "umami", metric: "checkouts", value: 0, capturedAt: at },
      { keyword: "CODING", source: "umami", metric: "emails", value: 1, capturedAt: at },
      { keyword: "CODING", source: "umami", metric: "visits", value: 2, capturedAt: at },
      { keyword: "SHARK", source: "umami", metric: "checkouts", value: 0, capturedAt: at },
      { keyword: "SHARK", source: "umami", metric: "emails", value: 1, capturedAt: at },
      { keyword: "SHARK", source: "umami", metric: "visits", value: 3, capturedAt: at },
    ]);
  });

  test("the next pull fetches from the day before the open day, counts only the open day, and still counts the stored final days", async () => {
    await pullUmami(access, NOW);
    fake.eventCalls = [];
    const later = new Date("2026-10-18T16:00:00.000Z");
    expect(await pullUmami(access, later)).toEqual({ kind: "complete", rows: { days: ["2026-10-18"], events: 11, keywords: 2 } });
    expect(fake.eventCalls[0].get("startAt")).toBe(String(Date.parse("2026-10-16T17:00:00.000Z")));
    expect(funnelRows().filter((r) => r.capturedAt === later.toISOString()).map((r) => [r.keyword, r.metric, r.value])).toEqual([
      ["CODING", "checkouts", 0],
      ["CODING", "emails", 1],
      ["CODING", "visits", 2],
      ["SHARK", "checkouts", 0],
      ["SHARK", "emails", 1],
      ["SHARK", "visits", 3],
    ]);
  });

  test("a 5xx on a later page is a partial pull and stores nothing", async () => {
    fake.failPage = 2;
    expect(await pullUmami(access, NOW)).toEqual({
      kind: "partial",
      rows: { days: ["2026-10-17", "2026-10-18"], events: 4, keywords: 0 },
      missing: "events after the first 4",
      reason: "Umami answered HTTP 503 on /api/websites/site-1/events",
    });
    expect(db.select().from(tables.umamiDays).all()).toEqual([]);
    expect(funnelRows()).toEqual([]);
  });

  test("an empty page before count is reached is a partial pull and stores nothing", async () => {
    fake.emptyPage = 2;
    expect(await pullUmami(access, NOW)).toEqual({
      kind: "partial",
      rows: { days: ["2026-10-17", "2026-10-18"], events: 4, keywords: 0 },
      missing: "events after the first 4",
      reason: "Umami sent an empty page 2 after 4 of 11 events",
    });
    expect(db.select().from(tables.umamiDays).all()).toEqual([]);
    expect(funnelRows()).toEqual([]);
  });

  test("an answer with no count keeps paging until an empty page (R3)", async () => {
    Object.assign(fake, { events: EVENTS.slice(0, 6), pageSize: 3, sendCount: false });
    expect(await pullUmami(access, NOW)).toEqual({ kind: "complete", rows: { days: ["2026-10-17", "2026-10-18"], events: 6, keywords: 2 } });
    expect(fake.eventCalls.map((q) => q.get("page"))).toEqual(["1", "2", "3"]);
  });

  test("a server that never sends an empty page stops at the page cap as a partial pull and stores nothing", async () => {
    Object.assign(fake, { ignorePage: true, sendCount: false });
    expect(await pullUmami(access, NOW)).toEqual({
      kind: "partial",
      rows: { days: ["2026-10-17", "2026-10-18"], events: 1600, keywords: 0 },
      missing: "events after the first 1600",
      reason: "Umami still had events after 400 pages",
    });
    expect(fake.eventCalls).toHaveLength(400);
    expect(db.select().from(tables.umamiDays).all()).toEqual([]);
  });

  test("a session that crosses VN midnight keeps its campaign on the next day, also when that day is pulled alone (R4)", async () => {
    fake.events = [pv("s", "2026-10-17T16:55:00.000Z", "/x?utm_campaign=shark"), pv("s", "2026-10-17T17:05:00.000Z", "/get/shark")];
    await pullUmami(access, NOW);
    const day2 = () => db.select().from(tables.umamiDays).all().find((d) => d.day === "2026-10-18")?.clean.byCampaign.shark?.giftVisits;
    expect(day2()).toBe(1);

    const later = new Date("2026-10-18T16:00:00.000Z");
    expect(await pullUmami(access, later)).toMatchObject({ kind: "complete", rows: { days: ["2026-10-18"] } });
    expect(day2()).toBe(1);
    expect(funnelRows().filter((r) => r.capturedAt === later.toISOString() && r.keyword === "SHARK" && r.metric === "visits").map((r) => r.value)).toEqual([1]);
  });

  test("checkouts are each campaign's checkout_click, and visit coverage is over every clean /get/ pageview", async () => {
    fake.events = [...EVENTS, ev("s1", "2026-10-17T01:03:00.000Z", "/free/shark.html", "checkout_click")];
    await pullUmami(access, NOW);
    const [shark] = await getFunnel("SHARK");
    expect(shark.metrics.find((m) => m.id === "checkout")).toMatchObject({ status: "value", value: 1 });
    expect(shark.metrics.find((m) => m.id === "checkout_rate")).toMatchObject({ status: "value", value: 1 / 3 });
    expect((await getFunnelBoard()).coverage.visits).toEqual({ status: "value", tied: 5, total: 6 });
  });

  test("progress is reported per events page, and a Stop between pages ends the pull as partial with nothing stored", async () => {
    const seen: string[] = [];
    let stop = false;
    const result = await pullUmami(access, NOW, {
      onPage: (p) => {
        seen.push(`${p.done}/${p.total} ${p.label}`);
        stop = p.done === 2;
      },
      shouldStop: () => stop,
    });
    expect(seen).toEqual(["1/3 events, last 2 days", "2/3 events, last 2 days"]);
    expect(result).toEqual({ kind: "partial", rows: { days: ["2026-10-17", "2026-10-18"], events: 8, keywords: 0 }, missing: "events after the first 8", reason: "you stopped the pull" });
    expect(db.select().from(tables.umamiDays).all()).toEqual([]);
    expect(funnelRows()).toEqual([]);
  });

  test("a rejected key fails the pull with the C13 message and stores nothing", async () => {
    expect(await pullUmami({ ...access, apiKey: "old-key" }, NOW)).toEqual({ kind: "failed", reason: "Umami rejected the key (401). Create a new key and paste it." });
    expect(funnelRows()).toEqual([]);
  });

  test("an address nothing answers on fails with Cannot reach and its host, kept as a SourceDownError", async () => {
    const result = await pullUmami({ ...access, url: "http://127.0.0.1:9" }, NOW);
    expect(result.kind).toBe("failed");
    const reason = result.kind === "failed" ? result.reason : null;
    expect(reason).toBeInstanceOf(SourceDownError);
    expect(reason instanceof Error && reason.message).toBe("Cannot reach 127.0.0.1:9. Check that your Umami server is up, then try again.");
  });

  test("the funnel totals are the per-keyword Umami sums of the last pull", async () => {
    expect(await getFunnelTotals()).toEqual({ gift_page_visit: null, email: null, checkout: null });
    fake.events = [...EVENTS, ev("s1", "2026-10-17T01:03:00.000Z", "/free/shark.html", "checkout_click")];
    await pullUmami(access, NOW);
    expect(await getFunnelTotals()).toEqual({ gift_page_visit: 5, email: 2, checkout: 1 });
  });
});

describe("Umami websites", () => {
  test("the key, sent as Bearer, finds the website under a team when the user's own list is empty", async () => {
    expect(await listUmamiWebsites(access.url, "key-1")).toEqual([{ id: "site-1", name: "kaiships", domain: "kai-ships-ai-website.vercel.app" }]);
    expect(fake.authHeaders).toEqual(["Bearer key-1", "Bearer key-1", "Bearer key-1"]);
  });

  test("a 401 maps to the C13 message", async () => {
    await expect(listUmamiWebsites(access.url, "wrong")).rejects.toThrow(UMAMI_KEY_REJECTED);
    expect(UMAMI_KEY_REJECTED).toBe("Umami rejected the key (401). Create a new key and paste it.");
  });
});

describe("Umami connector", () => {
  const save = (values: Partial<Record<"UMAMI_URL" | "UMAMI_API_KEY" | "UMAMI_WEBSITE_ID", string>>) => {
    for (const [name, value] of Object.entries(values)) setSecret(name, value);
  };

  test("reads its three secrets from the store, samples the website line, and names a rejected key", async () => {
    expect(await connector.adapter?.testConnection()).toEqual({ ok: false, message: "Umami address, API key or website is missing. Connect Umami." });
    expect(await connector.adapter?.pull?.()).toEqual({ kind: "failed", reason: "Umami address, API key or website is missing. Connect Umami." });

    save({ UMAMI_URL: access.url.replace(/\/$/, ""), UMAMI_API_KEY: "key-1", UMAMI_WEBSITE_ID: "site-1" });
    expect(await connector.adapter?.testConnection()).toEqual({ ok: true, message: null });
    expect(await connector.adapter?.sample?.()).toEqual({ ok: true, line: `kai-ships-ai-website.vercel.app · ${new URL(access.url).host}` });

    save({ UMAMI_WEBSITE_ID: "site-2" });
    expect(await connector.adapter?.testConnection()).toEqual({ ok: false, message: "This key cannot read the saved website. Connect Umami again and pick a website." });

    save({ UMAMI_WEBSITE_ID: "site-1", UMAMI_API_KEY: "wrong" });
    expect(await connector.adapter?.testConnection()).toEqual({ ok: false, message: "Umami rejected the key (401). Create a new key and paste it." });
  });
});

describe("Umami key save", () => {
  const keychain = getSecretStore();
  afterEach(() => setSecretStore(keychain));
  const stored = () => ["UMAMI_URL", "UMAMI_API_KEY", "UMAMI_WEBSITE_ID", "UMAMI_USERNAME", "UMAMI_PASSWORD"].map((n) => getSecret(n) ?? null);

  test("Save tests the key again, stores the trimmed key with the address and the pick, and clears the old login", async () => {
    setSecret("UMAMI_USERNAME", "kai");
    setSecret("UMAMI_PASSWORD", "old-password");
    expect(await saveUmamiKeyAction(access.url, "wrong", "site-1")).toEqual({ ok: false, error: UMAMI_KEY_REJECTED });
    expect(await saveUmamiKeyAction(access.url, "key-1", "site-9")).toEqual({ ok: false, error: "That website is not readable with this key. Test again and pick one." });
    expect(stored()).toEqual([null, null, null, "kai", "old-password"]);

    expect(await saveUmamiKeyAction(`${access.url}/`, "  key-1\n", "site-1")).toEqual({ ok: true });
    expect(stored()).toEqual([access.url.replace(/\/$/, ""), "key-1", "site-1", null, null]);
    expect(fake.authHeaders.every((h) => h === "Bearer key-1" || h === "Bearer wrong")).toBe(true);
  });

  test("a write that fails mid-save keeps every old value", async () => {
    setSecret("UMAMI_URL", "https://old.example");
    setSecret("UMAMI_API_KEY", "old-key");
    setSecret("UMAMI_PASSWORD", "old-password");
    setSecretStore({ ...keychain, encryptString: (v) => (v === "key-1" ? (() => { throw new Error("keychain write failed"); })() : keychain.encryptString(v)) });
    expect(await saveUmamiKeyAction(access.url, "key-1", "site-1")).toEqual({ ok: false, error: "keychain write failed" });
    expect(stored()).toEqual(["https://old.example", "old-key", null, null, "old-password"]);
  });

  test("an unreachable address samples as down, so the card offers Change address", async () => {
    setSecret("UMAMI_URL", "http://127.0.0.1:9");
    setSecret("UMAMI_API_KEY", "key-1");
    setSecret("UMAMI_WEBSITE_ID", "site-1");
    expect(await connector.adapter?.sample?.()).toEqual({ ok: false, message: "Cannot reach 127.0.0.1:9. Check that your Umami server is up, then try again.", retryAfter: null, down: true });
    setSecret("UMAMI_API_KEY", "wrong");
    setSecret("UMAMI_URL", access.url);
    expect(await connector.adapter?.sample?.()).toMatchObject({ ok: false, down: false });
  });
});
