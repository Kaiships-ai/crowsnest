// server.ts
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { ensurePtyExecutable } from "./src/server/terminal/pty-perms";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, port });

app.prepare().then(() => {
  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();
  ensurePtyExecutable();
  const server = createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    // Task 4 replaces this echo with the pty relay.
    ws.on("message", (data) => ws.send(data.toString()));
  });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (url.startsWith("/api/terminal/ws")) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      upgrade(req, socket, head); // Next HMR and everything else, do not destroy
    }
  });

  server.listen(port, () => console.log(`ready on http://localhost:${port}`));
});
