// server.ts
// MUST be first: sets globalThis.AsyncLocalStorage before any Next module loads, so a
// custom `tsx server.ts` entrypoint does not crash on Next 16's AsyncLocalStorage
// invariant. See src/server/als-polyfill.ts for the full explanation.
import "./src/server/als-polyfill";
import { createServer } from "node:http";
import next from "next";
import { handleMcpRequest } from "./src/server/mcp/http";
import { startOwnMeasureScheduler } from "./src/server/services/own-measure-scheduler";
import { startPublishScheduler } from "./src/server/services/publish-scheduler";
import { startSyncScheduler } from "./src/server/services/sync-scheduler";

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

  // Start the in-process publish scheduler. It claims due scheduled posts and publishes
  // them (see publish-scheduler.ts); this is the only place it is booted, and server.ts
  // runs only as the server entrypoint, never under tests or the CLI. A scheduler that
  // fails to start must never stop the server from listening, so it is guarded.
  try {
    startPublishScheduler();
  } catch (err) {
    console.error("startPublishScheduler failed on boot:", err);
  }

  // Start the in-process sync scheduler beside the publish scheduler. It reads the
  // syncCadenceMinutes setting each tick and starts a library sweep when the cadence has
  // elapsed since the last sync (see sync-scheduler.ts). Same guard: a scheduler that fails
  // to start must never stop the server from listening.
  try {
    startSyncScheduler();
  } catch (err) {
    console.error("startSyncScheduler failed on boot:", err);
  }

  // Start the own-channel measurement scheduler: hourly ticks measure reels under 72 hours
  // old every hour and older posts daily, under a 150-call budget (own-measure.ts). Same
  // guard: a scheduler that fails to start must never stop the server from listening.
  try {
    startOwnMeasureScheduler();
  } catch (err) {
    console.error("startOwnMeasureScheduler failed on boot:", err);
  }

  // HOST is unset in dev (binds all interfaces, unchanged). The packaged LaunchAgent sets
  // HOST=127.0.0.1 so a buyer's Mac never shows the "accept incoming connections" firewall
  // prompt on first run.
  const host = process.env.HOST;
  const onReady = () => console.log(`ready on http://localhost:${port}`);
  if (host) server.listen(port, host, onReady);
  else server.listen(port, onReady);
});
