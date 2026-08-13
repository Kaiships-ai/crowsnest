import { mkdirSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { sandboxDir, slugify } from "@/server/studio/paths";
import { getPlannedPostTitleById } from "./resolve-post";
import { createTerminalSession } from "./session";

/**
 * Relays a per-post pty session over the websocket. The cwd is always server-computed
 * from the resolved post's title, never taken from the client, so a client cannot walk
 * a pty into an arbitrary directory by supplying a path.
 */
export async function attachTerminal(ws: WebSocket, req: IncomingMessage): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const postId = url.searchParams.get("post");
  if (!postId) {
    ws.close(1008, "missing post");
    return;
  }

  const title = await getPlannedPostTitleById(postId);
  if (title === null) {
    ws.close(1008, "unknown post");
    return;
  }

  const dir = sandboxDir(slugify(title));
  mkdirSync(dir, { recursive: true });

  const session = createTerminalSession({ cwd: dir });

  session.onData((data) => {
    ws.send(JSON.stringify({ type: "output", data }));
  });

  session.onExit((code) => {
    ws.send(JSON.stringify({ type: "exit", code }));
    ws.close();
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input") {
        session.write(msg.data);
      } else if (msg.type === "resize") {
        session.resize(msg.cols, msg.rows);
      }
    } catch {
      // A malformed frame must not throw out of a ws "message" listener: this custom
      // server hosts the whole Next app in one process, and an uncaught throw here
      // would take the entire dev server down, not just this connection.
      ws.close(1008, "bad frame");
    }
  });

  ws.on("close", () => {
    session.kill();
  });
}
