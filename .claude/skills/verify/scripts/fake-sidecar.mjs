import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";

const portFile = path.resolve(import.meta.dirname, "../../../../data/verify/app/fake-sidecar.port");
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fake");
  console.log(`fake-sidecar: ${req.method} ${url.pathname}${url.search}`);
  if (url.pathname !== "/profile") {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "fake sidecar answers /profile only" }));
    return;
  }
  const username = (url.searchParams.get("handle") ?? "").replace(/^@/, "");
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ username, pk: `fake-${username}`, full_name: `Fake ${username}`, follower_count: 2500, following_count: 10, media_count: 30 }));
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
  console.log(`fake-sidecar: listening on ${server.address().port}`);
});
