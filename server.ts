// Headless crowsnest: the MCP at /api/mcp and the jobs, with no app window. The Lead Studio
// app serves the same MCP itself (src/main/crowsnest/start.ts); this entry is for the
// packaged LaunchAgent (src/kai-cli/service-darwin.ts).
import { createServer } from "node:http";
import { handleMcpRequest } from "./src/server/mcp/http";
import { startJobs } from "./src/server/start";

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

// The packaged LaunchAgent sets HOST=127.0.0.1 so a buyer's Mac never shows the "accept
// incoming connections" firewall prompt on first run.
const onReady = () => console.log(`ready on http://localhost:${port}`);
if (process.env.HOST) server.listen(port, process.env.HOST, onReady);
else server.listen(port, onReady);
