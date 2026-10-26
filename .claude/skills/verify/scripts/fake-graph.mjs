import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";

// Also the fake S3 bucket for publish: PUT and DELETE under /bucket/ succeed, and a GET under
// /public/ serves the stored bytes the way Graph would fetch the video and cover.
const portFile = path.resolve(import.meta.dirname, "../../../../data/verify/app/fake-graph.port");
const objects = new Map();
let calls = 0;

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
  const params = new URLSearchParams(req.method === "POST" ? body.toString() : searchParams);
  params.delete("access_token");
  console.log(`fake-graph: call ${calls} ${req.method} ${pathname} ${params}`);
  if (req.method === "POST" && pathname.endsWith("/media")) return json({ id: "17900000000000001" });
  if (req.method === "POST" && pathname.endsWith("/media_publish")) return json({ id: "17900000000000002" });
  if (params.get("fields") === "status_code") return json({ status_code: "FINISHED" });
  json(
    /\/(media|insights)$/.test(pathname)
      ? { data: [] }
      : { id: "17841400000000000", username: "fake_graph_account", followers_count: 1234, follows_count: 5, media_count: 0 },
  );
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
  console.log(`fake-graph: listening on ${server.address().port}`);
});
