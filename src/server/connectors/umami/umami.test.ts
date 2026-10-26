import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { getFunnelBoard } from "@/server/queries/funnel-board";
import { setSecret } from "@/server/secrets/store";
import { getFunnel } from "@/server/services/funnel";
import type { UmamiEvent } from "./days";
import { connector } from "./index";
import { pullUmami, type UmamiAccess } from "./pull";

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
const fake = { failPage: 0, failLogin: false, eventCalls: [] as URLSearchParams[], events: EVENTS, pageSize: 4, sendCount: true };
let server: Server;
let access: UmamiAccess;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/api/auth/login") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { username, password } = JSON.parse(body);
        if (fake.failLogin) return send(502, { error: "down" });
        send(username === "kai" && password === "pw-secret" ? 200 : 401, username === "kai" && password === "pw-secret" ? { token: "tok" } : { error: "bad" });
      });
      return;
    }
    if (req.headers.authorization !== "Bearer tok") return send(401, { error: "no token" });
    if (url.pathname === "/api/websites/site-1") return send(200, { id: "site-1", name: "kaiships" });
    if (url.pathname === "/api/websites/site-1/events") {
      fake.eventCalls.push(url.searchParams);
      const page = Number(url.searchParams.get("page"));
      if (page === fake.failPage) return send(503, { error: "busy" });
      const from = Number(url.searchParams.get("startAt"));
      const to = Number(url.searchParams.get("endAt"));
      const inRange = fake.events.filter((e) => Date.parse(e.createdAt) >= from && Date.parse(e.createdAt) <= to);
      const data = inRange.slice((page - 1) * fake.pageSize, page * fake.pageSize);
      return send(200, fake.sendCount ? { data, count: inRange.length, page, pageSize: fake.pageSize } : { data, page, pageSize: fake.pageSize });
    }
    send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  access = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, websiteId: "site-1", username: "kai", password: "pw-secret" };
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  migrate();
  for (const t of [tables.umamiDays, tables.reelFunnel, tables.plannedPosts, tables.sealedSecrets, tables.secrets]) await db.delete(t);
  Object.assign(fake, { failPage: 0, failLogin: false, eventCalls: [], events: EVENTS, pageSize: 4, sendCount: true });
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
    expect(fake.eventCalls.map((q) => q.get("page"))).toEqual(["1", "2", "3", "4"]);
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

  test("an answer with no count keeps paging until an empty page (R3)", async () => {
    Object.assign(fake, { events: EVENTS.slice(0, 6), pageSize: 3, sendCount: false });
    expect(await pullUmami(access, NOW)).toEqual({ kind: "complete", rows: { days: ["2026-10-17", "2026-10-18"], events: 6, keywords: 2 } });
    expect(fake.eventCalls.map((q) => q.get("page"))).toEqual(["1", "2", "3"]);
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

  test("a failed login is a failed pull and stores nothing", async () => {
    fake.failLogin = true;
    expect(await pullUmami(access, NOW)).toEqual({ kind: "failed", reason: "Umami answered HTTP 502 on /api/auth/login" });
    expect(funnelRows()).toEqual([]);
  });
});

describe("Umami connector", () => {
  const save = (values: Partial<Record<"UMAMI_URL" | "UMAMI_WEBSITE_ID" | "UMAMI_USERNAME" | "UMAMI_PASSWORD", string>>) => {
    for (const [name, value] of Object.entries(values)) setSecret(name, value);
  };

  test("reads its four secrets from the store, checks the website, and never echoes the password", async () => {
    expect(await connector.adapter?.testConnection()).toEqual({ ok: false, message: "Umami address, website id, username or password is missing" });
    expect(await connector.adapter?.pull?.()).toEqual({ kind: "failed", reason: "Umami address, website id, username or password is missing" });

    save({ UMAMI_URL: access.url, UMAMI_WEBSITE_ID: "site-1", UMAMI_USERNAME: "kai", UMAMI_PASSWORD: "pw-secret" });
    expect(await connector.adapter?.testConnection()).toEqual({ ok: true, message: null });

    save({ UMAMI_WEBSITE_ID: "site-2" });
    expect(await connector.adapter?.testConnection()).toEqual({ ok: false, message: "Umami answered HTTP 404 on /api/websites/site-2" });

    save({ UMAMI_WEBSITE_ID: "site-1", UMAMI_PASSWORD: "wrong" });
    const check = await connector.adapter?.testConnection();
    expect(check).toEqual({ ok: false, message: "Umami answered HTTP 401 on /api/auth/login" });
  });
});
