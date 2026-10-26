import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";

// Answers the Umami calls the umami connector makes, shaped like ksa_sync.py reads them:
// POST /api/auth/login, GET /api/websites/:id, GET /api/websites/:id/events (pages of 3).
// POST /__fail?page=N makes events page N answer 503 until POST /__fail?page=0.
const USER = { username: "lane-umami", password: "lane-umami-pass" };
const WEBSITE_ID = "lane-site";
const TOKEN = "lane-umami-token";
const PAGE_SIZE = 3;
let failPage = 0;

// Spread across the asked window less its first day, which the connector reads only to seed session campaigns, so every event lands on a day being counted.
function events(startAt, endAt) {
  const from = startAt + 86_400_000;
  const at = (k) => new Date(from + ((endAt - from) * k) / 10).toISOString();
  const pv = (sessionId, k, url) => {
    const [urlPath, urlQuery = null] = url.split("?");
    return { id: `${sessionId}-${k}`, websiteId: WEBSITE_ID, sessionId, createdAt: at(k), urlPath, urlQuery, eventType: 1, eventName: null };
  };
  const ev = (sessionId, k, urlPath, eventName) => ({ id: `${sessionId}-${k}`, websiteId: WEBSITE_ID, sessionId, createdAt: at(k), urlPath, urlQuery: null, eventType: 2, eventName });
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

const portFile = path.resolve(import.meta.dirname, "../../../../data/verify/app/fake-umami.port");
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fake");
  console.log(`fake-umami: ${req.method} ${url.pathname}${url.search}`);
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__fail") {
    failPage = Number(url.searchParams.get("page") ?? 0);
    return send(200, { failPage });
  }
  if (url.pathname === "/api/auth/login") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { username, password } = JSON.parse(body || "{}");
      if (username === USER.username && password === USER.password) send(200, { token: TOKEN, user: { id: "u1", username } });
      else send(401, { error: "Incorrect username and/or password." });
    });
    return;
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "Unauthorized" });
  if (url.pathname === `/api/websites/${WEBSITE_ID}`) return send(200, { id: WEBSITE_ID, name: "lane site", domain: "example.com" });
  if (url.pathname === `/api/websites/${WEBSITE_ID}/events`) {
    const page = Number(url.searchParams.get("page") ?? 1);
    if (page === failPage) return send(503, { error: "fake 503" });
    const all = events(Number(url.searchParams.get("startAt")), Number(url.searchParams.get("endAt")));
    return send(200, { data: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), count: all.length, page, pageSize: PAGE_SIZE });
  }
  send(404, { error: "not found" });
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
  console.log(`fake-umami: listening on ${server.address().port}`);
});
