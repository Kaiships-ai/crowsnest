import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";

const portFile = path.resolve(import.meta.dirname, "../../../../data/verify/app/fake-sidecar.port");
// POST /__session?state=expired makes every Instagram call answer the way the real sidecar does
// for an expired session (Instagram's ClientError "login_required" maps to IG_AUTH_REQUIRED, 401);
// state=ok restores it. POST /login-by-session adopts a browser session id, as the real one does.
// POST /__mode sets how a rival pull goes, counting /profile calls from that moment:
//   delayMs=N    every /profile answers after N ms (slow mode)
//   limitAt=N    the Nth /profile answers 429 IG_RATE_LIMITED with retry_after_sec (default 1800)
//   dieAt=N      the Nth /profile closes every connection and stops listening for downMs (default 8000)
//   loggedOut=1  /health says the sidecar has no Instagram session
// A bare POST /__mode resets them all.
let session = "ok";
// POST /__medias?state=empty answers /medias with an empty last page, so a sync succeeds;
// state=partial answers page 1 with a cursor and page 2 with 503, so each rival's walk is cut;
// state=refuse (the default) answers 503 like every other unserved path.
let medias = "refuse";
let mode = {};
let profiles = 0;
const LIMITED = (sec) => ({
  error: {
    code: "IG_RATE_LIMITED",
    message: "Instagram is rate-limiting this account.",
    retryable: true,
    detail: { retry_after_sec: sec },
  },
});
const EXPIRED = {
  error: {
    code: "IG_AUTH_REQUIRED",
    message: "Instagram session expired — re-authenticate.",
    retryable: true,
    detail: { exception: "ClientError", upstream_message: "login_required" },
  },
};
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fake");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString();
    console.log(`fake-sidecar: ${req.method} ${url.pathname}${url.search}${body ? ` ${body}` : ""}`);
    if (url.pathname === "/__mode") {
      const n = (k) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : undefined);
      mode = { delayMs: n("delayMs"), limitAt: n("limitAt"), retryAfterSec: n("retryAfterSec") ?? 1800, dieAt: n("dieAt"), downMs: n("downMs") ?? 8000, loggedOut: n("loggedOut") === 1 };
      profiles = 0;
      return send(res, 200, mode);
    }
    if (url.pathname === "/__session") {
      session = url.searchParams.get("state") ?? "ok";
      return send(res, 200, { session });
    }
    if (url.pathname === "/__medias") {
      medias = url.searchParams.get("state") ?? "refuse";
      return send(res, 200, { medias });
    }
    // A session id with "expired" in it is refused the way an expired cookie is.
    if (url.pathname === "/login-by-session") {
      if (body.includes("expired")) return send(res, 401, EXPIRED);
      session = "ok";
      return send(res, 200, { status: "ok" });
    }
    // The real /health never calls Instagram, so it answers the same with an expired session.
    if (url.pathname === "/health") {
      return send(res, 200, { status: "ok", logged_in: !mode.loggedOut, username: mode.loggedOut ? null : "fake_sidecar", instagrapi_version: "fake", session_loaded: true, session_path: "/tmp/fake-session.json", media_root: "/tmp/fake-media", can_login: false, cooldown_until: null });
    }
    if (session === "expired") return send(res, 401, EXPIRED);
    const username = (url.searchParams.get("handle") ?? "").replace(/^@/, "");
    if (url.pathname === "/medias" && medias === "empty") return send(res, 200, { items: [], next_cursor: null, stop_reason: "exhausted" });
    if (url.pathname === "/medias" && medias === "partial") {
      if (url.searchParams.get("cursor")) return send(res, 503, { error: "fake sidecar: page 2 refused (partial mode)" });
      const takenAt = new Date(Date.now() - 86_400_000).toISOString();
      return send(res, 200, { items: [{ pk: `fake-${username}-1`, code: `fake${username}`, media_type: "video", product_type: "clips", taken_at: takenAt, play_count: 1200 }], next_cursor: "p2", stop_reason: null });
    }
    if (url.pathname !== "/profile") return send(res, 503, { error: "fake sidecar answers /profile only" });
    profiles += 1;
    if (mode.dieAt === profiles) {
      console.log(`fake-sidecar: dying at profile ${profiles} for ${mode.downMs}ms`);
      server.close();
      server.closeAllConnections();
      setTimeout(() => server.listen(port, "127.0.0.1", () => console.log("fake-sidecar: back")), mode.downMs);
      return;
    }
    if (mode.limitAt === profiles) return send(res, 429, LIMITED(mode.retryAfterSec));
    const answer = () => send(res, 200, { username, pk: `fake-${username}`, full_name: `Fake ${username}`, follower_count: 2500, following_count: 10, media_count: 30 });
    if (mode.delayMs) setTimeout(answer, mode.delayMs);
    else answer();
  });
});
let port = 0;
server.listen(0, "127.0.0.1", () => {
  port = server.address().port;
  writeFileSync(portFile, String(port));
  console.log(`fake-sidecar: listening on ${port}`);
});
