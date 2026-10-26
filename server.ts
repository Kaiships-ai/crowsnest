import { rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { handleMcpRequest } from "./src/server/mcp/http";
import { rotateLocalMcpToken, startJobs } from "./src/server/start";

const port = Number(process.env.PORT);
if (!port) throw new Error("server.ts: set PORT");

const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/mcp")) {
    void handleMcpRequest(req, res);
    return;
  }
  res.writeHead(404).end();
});

startJobs();

// The `local` agent token, next to the DB, for a client on this Mac to send as `Authorization: Bearer`.
const tokenFile = path.join(path.dirname(process.env.CROWSNEST_DB_PATH ?? "data/crowsnest.db"), "mcp.token");
rmSync(tokenFile, { force: true });
writeFileSync(tokenFile, rotateLocalMcpToken(), { mode: 0o600 });

// The packaged LaunchAgent sets HOST=127.0.0.1 so a buyer's Mac never shows the "accept
// incoming connections" firewall prompt on first run.
const onReady = () => console.log(`ready on http://localhost:${port}`);
if (process.env.HOST) server.listen(port, process.env.HOST, onReady);
else server.listen(port, onReady);
