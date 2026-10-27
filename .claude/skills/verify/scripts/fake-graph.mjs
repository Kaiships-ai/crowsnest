import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";

// POST /__mode sets how the Graph reads answer, counting calls from that moment:
//   posts=N      /media lists N reels (default 1), each with its own caption
//   budget=N     after N calls every read answers Instagram's rate limit (HTTP 400, code 4)
//   delayMs=N    every read answers after N ms (slow mode)
//   expired=1    every read answers an expired token (HTTP 400, code 190)
// A bare POST /__mode resets them all. A token containing "expired" is always refused as expired.
// Also the fake S3 bucket for publish: PUT and DELETE under /bucket/ succeed, and a GET under
// /public/ serves the stored bytes the way Graph would fetch the video and cover.
const portFile = path.resolve(import.meta.dirname, "../../../../data/verify/app/fake-graph.port");
const objects = new Map();
let calls = 0;
let mode = {};
let modeCalls = 0;

const read = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

const server = createServer(async (req, res) => {
  calls += 1;
  const { pathname, searchParams } = new URL(req.url, "http://fake");
  const body = await read(req);
  const json = (value, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (pathname.startsWith("/bucket/")) {
    const key = pathname.slice("/bucket/".length);
    console.log(`fake-s3: ${req.method} ${key} ${body.length} bytes`);
    if (req.method === "PUT") objects.set(key, body);
    if (req.method === "DELETE") objects.delete(key);
    res.writeHead(req.method === "DELETE" ? 204 : 200);
    return res.end();
  }
  if (pathname.startsWith("/public/")) {
    const object = objects.get(pathname.slice("/public/".length));
    res.writeHead(object ? 200 : 404);
    return res.end(object);
  }
  if (pathname === "/__mode") {
    const n = (k) => (searchParams.has(k) ? Number(searchParams.get(k)) : undefined);
    mode = { posts: n("posts"), budget: n("budget"), delayMs: n("delayMs"), expired: n("expired") === 1 };
    modeCalls = 0;
    console.log(`fake-graph: mode ${JSON.stringify(mode)}`);
    return json(mode);
  }
  const params = new URLSearchParams(req.method === "POST" ? body.toString() : searchParams);
  const token = params.get("access_token") ?? "";
  params.delete("access_token");
  modeCalls += 1;
  console.log(`fake-graph: call ${calls} ${req.method} ${pathname} ${params}`);
  if (mode.delayMs) await new Promise((r) => setTimeout(r, mode.delayMs));
  if (mode.expired || token.includes("expired")) {
    console.log("fake-graph: refused: expired token");
    return json({ error: { message: "Error validating access token: Session has expired.", type: "OAuthException", code: 190, error_subcode: 463, fbtrace_id: "fake" } }, 400);
  }
  if (mode.budget !== undefined && modeCalls > mode.budget) {
    console.log(`fake-graph: refused: rate limit after ${mode.budget} calls`);
    return json({ error: { message: "Application request limit reached", type: "OAuthException", is_transient: true, code: 4, fbtrace_id: "fake" } }, 400);
  }
  if (req.method === "POST" && pathname.endsWith("/media")) return json({ id: "17900000000000001" });
  if (req.method === "POST" && pathname.endsWith("/media_publish")) return json({ id: "17900000000000002" });
  if (params.get("fields") === "status_code") return json({ status_code: "FINISHED" });
  const posts = reels(mode.posts ?? 1);
  const mediaId = pathname.match(/\/(\d+)\/insights$/)?.[1];
  if (mediaId && posts.some((p) => p.id === mediaId)) return reelInsights(params, json);
  if (pathname.endsWith("/insights")) return accountInsights(params, json);
  if (pathname.endsWith("/media")) return json({ data: process.env.FAKE_GRAPH_NO_MEDIA === "1" ? [] : posts.slice(0, Number(params.get("limit") ?? 25)) });
  json({ id: "17841400000000000", username: "fake_graph_account", followers_count: 1234, follows_count: 5, media_count: 1 });
});

// Reads answer the way Graph v23 does for a reel, refusals included: one refused metric or
// breakdown fails the whole call with HTTP 400 and code 100, as the first real-data run saw.
// The two metric messages are Graph's wording from that run; the breakdown wording is not, the
// refusal itself is. A fake that accepted anything hid all three bugs.
const REEL = {
  id: "17900000000000100",
  media_type: "VIDEO",
  media_product_type: "REELS",
  permalink: "https://www.instagram.com/reel/FAKEREEL/",
  timestamp: "2026-10-20T09:00:00+0000",
  like_count: 12,
  comments_count: 0,
  caption: "fake reel FAKE01",
};
const reels = (n) =>
  Array.from({ length: n }, (_, i) =>
    i === 0 ? REEL : { ...REEL, id: String(BigInt(REEL.id) + BigInt(i)), permalink: `https://www.instagram.com/reel/FAKEREEL${i}/`, caption: `fake reel ${String(i + 1).padStart(2, "0")}: 3 Claude Code tricks` },
  );
const REEL_METRICS = new Set([
  "views", "reach", "likes", "comments", "shares", "saved", "total_interactions",
  "ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate",
]);
const ACCOUNT_BREAKDOWNS = { views: ["follow_type", "media_product_type"], engaged_audience_demographics: ["age", "city", "country", "gender"] };
const refuse = (json, message) => {
  console.log(`fake-graph: refused: ${message}`);
  json({ error: { message, type: "OAuthException", code: 100, fbtrace_id: "fake" } }, 400);
};

function reelInsights(params, json) {
  const metrics = (params.get("metric") ?? "").split(",");
  if (metrics.includes("profile_activity")) {
    return refuse(json, "The Media Insights API does not support the profile_activity metric for this media product type.");
  }
  const refused = metrics.filter((m) => !REEL_METRICS.has(m));
  if (refused.length) return refuse(json, `The Media Insights API does not support the metrics: ${refused.join(", ")}`);
  json({ data: metrics.map((name, i) => ({ name, period: "lifetime", values: [{ value: 10 + i }] })) });
}

function accountInsights(params, json) {
  const metric = params.get("metric");
  const breakdown = params.get("breakdown");
  const allowed = ACCOUNT_BREAKDOWNS[metric];
  if (breakdown && allowed && !allowed.includes(breakdown)) {
    return refuse(json, `(#100) breakdown[0] must be one of the following values: ${allowed.join(", ")}`);
  }
  json({ data: [] });
}
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
  console.log(`fake-graph: listening on ${server.address().port}`);
});
