import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";

// Answers GET /v1/organizations the way api.polar.sh does: the lane token sees one organization
// (Kaiships), any other token gets Polar's 401 body. POST /__mode?m=<mode> sets how it answers until
// m=up: down drops every API connection as an unreachable Polar does, slow answers after 2 s,
// revoked refuses the lane token too. The app reaches it through POLAR_API_URL.
const TOKEN = "polar_oat_lane_good";
let mode = "up";

const portFile = path.resolve(import.meta.dirname, "../../../../data/verify/app/fake-polar.port");
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fake");
  console.log(`fake-polar: ${req.method} ${url.pathname}${url.search}${mode === "up" ? "" : ` (${mode})`}`);
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__mode") {
    mode = url.searchParams.get("m") ?? "up";
    return send(200, { mode });
  }
  if (mode === "down") return req.socket.destroy();
  if (mode === "slow") return setTimeout(() => answer(req, send), 2000);
  answer(req, send);
});

function answer(req, send) {
  if (new URL(req.url, "http://fake").pathname !== "/v1/organizations") return send(404, { detail: "Not Found" });
  if (mode === "revoked" || req.headers.authorization !== `Bearer ${TOKEN}`) {
    return send(401, { error: "invalid_token", error_description: "The access token provided is expired, revoked, malformed, or invalid for other reasons." });
  }
  send(200, {
    items: [{ id: "lane-org", name: "Kaiships", slug: "kaiships", created_at: "2026-01-01T00:00:00Z" }],
    pagination: { total_count: 1, max_page: 1 },
  });
}
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
  console.log(`fake-polar: listening on ${server.address().port}`);
});
