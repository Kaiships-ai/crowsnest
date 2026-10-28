import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";

// Answers the Umami calls the umami connector makes, as Umami v2 does for an admin whose one website sits under a team:
// GET /api/websites (empty), /api/teams, /api/teams/:id/websites, /api/websites/:id/events (pages of 3), each with `Authorization: Bearer <key>`.
// POST /__mode?m=<mode> switches how it answers until the next switch:
//   normal; two-sites (the team holds a second website); reject (401 to every key); down (drops every connection);
//   slow&ms=N[&size=K] (every API answer waits N ms; events pages hold K events, 3 by default). POST /__fail?page=N makes events page N answer 503 until POST /__fail?page=0.
const API_KEY = "lane-umami-key";
const WEBSITE = { id: "lane-site", name: "lane site", domain: "lane-site.example" };
const SECOND = { id: "lane-site-2", name: "gift site", domain: "gift.lane-site.example" };
const TEAM = { id: "lane-team", name: "kaiships" };
const PAGE_SIZE = 3;
let mode = { m: "normal", ms: 0, size: PAGE_SIZE };
let failPage = 0;

// Spread across the asked window less its first day, which the connector reads only to seed session campaigns, so every event lands on a day being counted.
function events(startAt, endAt) {
  const from = startAt + 86_400_000;
  const at = (k) => new Date(from + ((endAt - from) * k) / 10).toISOString();
  const pv = (sessionId, k, url) => {
    const [urlPath, urlQuery = null] = url.split("?");
    return { id: `${sessionId}-${k}`, websiteId: WEBSITE.id, sessionId, createdAt: at(k), urlPath, urlQuery, eventType: 1, eventName: null };
  };
  const ev = (sessionId, k, urlPath, eventName) => ({ id: `${sessionId}-${k}`, websiteId: WEBSITE.id, sessionId, createdAt: at(k), urlPath, urlQuery: null, eventType: 2, eventName });
  return [
    pv("s1", 1, "/get/own01?utm_campaign=own01&utm_source=ig_dm&utm_medium=social"),
    pv("s1", 2, "/get/own01?utm_campaign=own01&utm_source=ig_dm&utm_medium=social"),
    ev("s1", 3, "/get/own01", "gift_signup"),
    pv("s2", 4, "/get/own01?utm_campaign=own01"),
    pv("s3", 5, "/get/own01?utm_campaign=OWN01"),
    ev("s3", 6, "/get/own01", "gift_signup"),
    pv("s4", 7, "/get/own01?utm_campaign=own01&utm_source=verify"),
    ev("s4", 8, "/get/own01", "gift_signup"),
    pv("s5", 9, "/get/own01"),
  ];
}

const list = (data) => ({ data, count: data.length, page: 1, pageSize: 200 });

const portFile = path.resolve(import.meta.dirname, "../../../../data/verify/app/fake-umami.port");
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fake");
  console.log(`fake-umami: ${req.method} ${url.pathname}${url.search} (${mode.m})`);
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const send = (status, body) => (mode.m === "slow" && url.pathname.startsWith("/api/") ? void setTimeout(() => reply(status, body), mode.ms) : reply(status, body));
  if (url.pathname === "/__mode") {
    mode = { m: url.searchParams.get("m") ?? "normal", ms: Number(url.searchParams.get("ms") ?? 0), size: Number(url.searchParams.get("size") ?? PAGE_SIZE) };
    return send(200, mode);
  }
  if (url.pathname === "/__fail") {
    failPage = Number(url.searchParams.get("page") ?? 0);
    return send(200, { failPage });
  }
  if (mode.m === "down") return req.socket.destroy();
  if (mode.m === "reject" || req.headers.authorization !== `Bearer ${API_KEY}`) return send(401, { error: "Unauthorized" });
  if (url.pathname === "/api/websites") return send(200, list([]));
  if (url.pathname === "/api/teams") return send(200, list([TEAM]));
  if (url.pathname === `/api/teams/${TEAM.id}/websites`) return send(200, list(mode.m === "two-sites" ? [WEBSITE, SECOND] : [WEBSITE]));
  if (url.pathname === `/api/websites/${WEBSITE.id}/events`) {
    const page = Number(url.searchParams.get("page") ?? 1);
    if (page === failPage) return send(503, { error: "fake 503" });
    const all = events(Number(url.searchParams.get("startAt")), Number(url.searchParams.get("endAt")));
    return send(200, { data: all.slice((page - 1) * mode.size, page * mode.size), count: all.length, page, pageSize: mode.size });
  }
  send(404, { error: "not found" });
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
  console.log(`fake-umami: listening on ${server.address().port}`);
});
