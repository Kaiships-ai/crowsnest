import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";

// A local stand-in for graph.instagram.com: one account, no media, empty insights.
const portFile = path.resolve(import.meta.dirname, "../../../../data/verify/app/fake-graph.port");
let calls = 0;
const server = createServer((req, res) => {
  calls += 1;
  const { pathname } = new URL(req.url, "http://fake");
  console.log(`fake-graph: call ${calls} ${req.method} ${pathname}`);
  const body = /\/(media|insights)$/.test(pathname)
    ? { data: [] }
    : { id: "17841400000000000", username: "fake_graph_account", followers_count: 1234, follows_count: 5, media_count: 0 };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
  console.log(`fake-graph: listening on ${server.address().port}`);
});
