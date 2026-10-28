#!/usr/bin/env node
// real-check.mjs umami|graph --db <lane crowsnest.db> [--proof <proof.json>]
// Read-only GETs with the keys test-keys.sh saved; prints app value vs real value, and with --proof
// writes the rows into that file's `numbers` list (a row with the same label is replaced).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const [service, ...rest] = process.argv.slice(2);
const arg = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
const dbPath = arg("--db");
const proofPath = arg("--proof");
if (!["umami", "graph"].includes(service) || !dbPath) {
  console.error("usage: real-check.sh umami|graph --db <lane crowsnest.db> [--proof <proof.json>]");
  process.exit(2);
}
const blocked = (why) => { console.error(`BLOCKED ${why}`); process.exit(1); };
if (!existsSync(dbPath)) blocked(`no lane DB at ${dbPath}`);

function loadEnv(name) {
  const file = `${homedir()}/.config/lead-studio-test/${name}.env`;
  if (!existsSync(file)) blocked(`need ${name} key: run test-keys.sh save ${name}`);
  return Object.fromEntries(readFileSync(file, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
}
const sql = (q) => JSON.parse(execFileSync("sqlite3", ["-readonly", "-json", dbPath, q], { encoding: "utf8" }).trim() || "[]");
async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${new URL(url).pathname}`);
  return res.json();
}

const rows = []; // { label, source, expected (real), app }

async function umami() {
  const { UMAMI_URL, UMAMI_API_KEY } = loadEnv("umami");
  const root = (/^https?:/i.test(UMAMI_URL) ? UMAMI_URL : `https://${UMAMI_URL}`).replace(/\/+$/, "");
  const auth = { authorization: `Bearer ${UMAMI_API_KEY}` };
  const list = (b) => (Array.isArray(b) ? b : (b.data ?? []));
  let siteId = process.env.UMAMI_WEBSITE_ID;
  if (!siteId) {
    const teams = list(await get(`${root}/api/teams?pageSize=200`, auth));
    const sites = [...list(await get(`${root}/api/websites?pageSize=200`, auth)),
      ...(await Promise.all(teams.map((t) => get(`${root}/api/teams/${t.id}/websites?pageSize=200`, auth).then(list)))).flat()];
    const ids = [...new Set(sites.map((s) => s.id))];
    if (ids.length !== 1) blocked(`key reads ${ids.length} websites; set UMAMI_WEBSITE_ID=<id>`);
    siteId = ids[0];
  }
  // The 7 complete Asia/Ho_Chi_Minh days before today, the same days the app stores in umami_days.
  const vnNow = Date.now() + 7 * 3_600_000;
  const days = Array.from({ length: 7 }, (_, i) => new Date(vnNow - (7 - i) * 86_400_000).toISOString().slice(0, 10));
  const real = { pageviews: 0, visitors: 0, checkout_click: 0 };
  for (const day of days) {
    const startAt = Date.parse(`${day}T00:00:00+07:00`);
    const q = `startAt=${startAt}&endAt=${startAt + 86_400_000 - 1}`;
    const stats = await get(`${root}/api/websites/${siteId}/stats?${q}`, auth);
    const val = (v) => (typeof v === "object" && v ? v.value : v) ?? 0;
    real.pageviews += val(stats.pageviews);
    real.visitors += val(stats.visitors);
    const events = await get(`${root}/api/websites/${siteId}/metrics?type=event&${q}`, auth);
    real.checkout_click += events.find((e) => e.x === "checkout_click")?.y ?? 0;
  }
  const app = { pageviews: 0, visitors: 0, checkout_click: 0 };
  for (const r of sql(`select clean from umami_days where day in (${days.map((d) => `'${d}'`).join(",")})`)) {
    const c = JSON.parse(r.clean);
    app.pageviews += c.pageviews; app.visitors += c.visitors; app.checkout_click += c.events?.checkout_click ?? 0;
  }
  const src = `Umami ${days[0]}..${days[6]}`;
  rows.push({ label: "Pageviews, 7 days", source: src, expected: real.pageviews, app: app.pageviews },
    { label: "Visitors, 7 days (sum of daily)", source: src, expected: real.visitors, app: app.visitors },
    { label: "checkout_click, 7 days", source: src, expected: real.checkout_click, app: app.checkout_click });
}

async function graph() {
  const { IG_GRAPH_TOKEN } = loadEnv("graph");
  const host = process.env.IG_GRAPH_HOST ?? "https://graph.instagram.com";
  const g = (path, params) => get(`${host}/v23.0/${path}?${new URLSearchParams({ ...params, access_token: IG_GRAPH_TOKEN })}`);
  const me = await g("me", { fields: "username,followers_count" });
  const [snap] = sql("select follower_count from own_account_snapshots order by captured_at desc limit 1");
  rows.push({ label: "Followers", source: `Graph @${me.username}`, expected: me.followers_count, app: snap?.follower_count ?? null });
  const media = (await g("me/media", { fields: "id,media_product_type,like_count,comments_count", limit: "50" })).data
    .filter((m) => m.media_product_type === "REELS").slice(0, 5);
  const mine = sql(`select p.external_id id, i.views, i.likes, i.comments from own_posts p
    join own_post_insights i on i.own_post_id = p.id and i.captured_at = (select max(captured_at) from own_post_insights where own_post_id = p.id)
    where p.product_type = 'REELS'`);
  for (const m of media) {
    const views = (await g(`${m.id}/insights`, { metric: "views" })).data?.[0]?.values?.[0]?.value ?? null;
    const a = mine.find((r) => r.id === m.id);
    const src = `Graph reel ${m.id}`;
    rows.push({ label: `Reel ${m.id.slice(-6)} views`, source: src, expected: views, app: a?.views ?? null },
      { label: `Reel ${m.id.slice(-6)} likes`, source: src, expected: m.like_count ?? null, app: a?.likes ?? null },
      { label: `Reel ${m.id.slice(-6)} comments`, source: src, expected: m.comments_count ?? null, app: a?.comments ?? null });
  }
}

try { await (service === "umami" ? umami() : graph()); } catch (e) { blocked(`${service} read failed: ${e.message.replace(/access_token=[^&\s]+/g, "access_token=***")}`); }

const width = Math.max(...rows.map((r) => r.label.length));
console.log(`${"what".padEnd(width)}  ${"app".padStart(8)}  ${"real".padStart(8)}  match`);
for (const r of rows) console.log(`${r.label.padEnd(width)}  ${String(r.app ?? "-").padStart(8)}  ${String(r.expected ?? "-").padStart(8)}  ${r.app === r.expected ? "ok" : "DIFF"}`);
if (proofPath) {
  const proof = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, "utf8")) : {};
  const labels = new Set(rows.map((r) => r.label));
  proof.numbers = [...(proof.numbers ?? []).filter((n) => !labels.has(n.label)), ...rows];
  writeFileSync(proofPath, JSON.stringify(proof, null, 2) + "\n");
  console.log(`real-check: wrote ${rows.length} rows to ${proofPath}`);
}
process.exit(rows.every((r) => r.app === r.expected) ? 0 : 1);
