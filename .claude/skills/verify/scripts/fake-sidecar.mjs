import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";

const portFile = path.resolve(import.meta.dirname, "../../../../data/verify/app/fake-sidecar.port");
// POST /__session?state=expired makes every Instagram call answer the way the real sidecar does
// for an expired session (Instagram's ClientError "login_required" maps to IG_AUTH_REQUIRED, 401);
// state=ok restores it. POST /login-by-session adopts a browser session id, as the real one does.
let session = "ok";
// POST /__medias?state=empty answers /medias with an empty last page, so a sync succeeds; state=refuse
// (the default) answers 503 like every other unserved path.
let medias = "refuse";
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
    if (url.pathname === "/__session") {
      session = url.searchParams.get("state") ?? "ok";
      return send(res, 200, { session });
    }
    if (url.pathname === "/__medias") {
      medias = url.searchParams.get("state") ?? "refuse";
      return send(res, 200, { medias });
    }
    if (url.pathname === "/login-by-session") {
      session = "ok";
      return send(res, 200, { status: "ok" });
    }
    // The real /health never calls Instagram, so it answers the same with an expired session.
    if (url.pathname === "/health") {
      return send(res, 200, { status: "ok", logged_in: true, username: "fake_sidecar", instagrapi_version: "fake", session_loaded: true, session_path: "/tmp/fake-session.json", media_root: "/tmp/fake-media", can_login: false, cooldown_until: null });
    }
    if (session === "expired") return send(res, 401, EXPIRED);
    if (url.pathname === "/medias" && medias === "empty") return send(res, 200, { items: [], next_cursor: null, stop_reason: "exhausted" });
    if (url.pathname !== "/profile") return send(res, 503, { error: "fake sidecar answers /profile only" });
    const username = (url.searchParams.get("handle") ?? "").replace(/^@/, "");
    send(res, 200, { username, pk: `fake-${username}`, full_name: `Fake ${username}`, follower_count: 2500, following_count: 10, media_count: 30 });
  });
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
  console.log(`fake-sidecar: listening on ${server.address().port}`);
});
