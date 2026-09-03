// server.ts
import { createServer } from "node:http";
import next from "next";
import { handleMcpRequest } from "./src/server/mcp/http";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, port });

app.prepare().then(() => {
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => {
    // The MCP endpoint is served in-process so its tools share this server's one SQLite
    // connection (see src/server/mcp/http.ts). Everything else goes to Next.
    if (req.url && req.url.startsWith("/api/mcp")) {
      void handleMcpRequest(req, res);
      return;
    }
    handle(req, res);
  });

  // HOST is unset in dev (binds all interfaces, unchanged). The packaged LaunchAgent sets
  // HOST=127.0.0.1 so a buyer's Mac never shows the "accept incoming connections" firewall
  // prompt on first run.
  const host = process.env.HOST;
  const onReady = () => console.log(`ready on http://localhost:${port}`);
  if (host) server.listen(port, host, onReady);
  else server.listen(port, onReady);
});
