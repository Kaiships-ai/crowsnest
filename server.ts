// server.ts
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { ensurePtyExecutable } from "./src/server/terminal/pty-perms";
import { attachTerminal } from "./src/server/terminal/ws";
import { reconcileOrphanCreateRuns } from "./src/server/queries/create-runs";
import { handleMcpRequest } from "./src/server/mcp/http";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, port });

app.prepare().then(() => {
  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();
  ensurePtyExecutable();
  const server = createServer((req, res) => {
    // The MCP endpoint is served in-process so its tools share this server's one SQLite
    // connection (see src/server/mcp/http.ts). Everything else goes to Next.
    if (req.url && req.url.startsWith("/api/mcp")) {
      void handleMcpRequest(req, res);
      return;
    }
    handle(req, res);
  });
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, req) => {
    void attachTerminal(ws, req);
  });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (url.startsWith("/api/terminal/ws")) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      upgrade(req, socket, head); // Next HMR and everything else, do not destroy
    }
  });

  // Any create_run left `running`/`waiting` by a previous process (killed, crashed,
  // redeployed) died with that process — its pid is gone, and nothing will ever move it
  // to a terminal status. Reconcile once at boot so the runs list and studio panel don't
  // show a cook as forever in progress. Never let a reconcile bug block the server from
  // listening — see create-runs.ts's reconcileOrphanCreateRuns for the pid-liveness check.
  try {
    const changed = reconcileOrphanCreateRuns();
    if (changed > 0) console.log(`reconciled ${changed} orphaned create run(s) on boot`);
  } catch (err) {
    console.error("reconcileOrphanCreateRuns failed on boot:", err);
  }

  server.listen(port, () => console.log(`ready on http://localhost:${port}`));
});
