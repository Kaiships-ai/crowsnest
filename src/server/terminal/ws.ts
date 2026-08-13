import { existsSync, mkdirSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { config } from "@/server/config";
import { getAssetStore } from "@/server/media/asset-store";
import { sandboxDir, slugify } from "@/server/studio/paths";
import { buildCookProfile } from "./harness-profile";
import { getPlannedPostTitleById } from "./resolve-post";
import { watchForRender } from "./render-watch";
import { createTerminalSession } from "./session";

/**
 * Relays a per-post pty session over the websocket. The cwd is always server-computed
 * from the resolved post's title, never taken from the client, so a client cannot walk
 * a pty into an arbitrary directory by supplying a path.
 */
export async function attachTerminal(ws: WebSocket, req: IncomingMessage): Promise<void> {
  // Closed over by the "error" handler below so a socket error is handled whether it
  // fires during setup (session still null) or after (session live and needs killing).
  // The ws library throws when a socket emits "error" with no listener attached, and
  // this custom server has no process-level uncaughtException handler, so an ordinary
  // uncleaned disconnect (ECONNRESET, a tab or laptop closing) would otherwise take
  // down the whole single-process app, not just this connection.
  let session: ReturnType<typeof createTerminalSession> | null = null;
  ws.on("error", () => {
    session?.kill();
  });

  try {
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

    const slug = slugify(title);
    if (slug === "") {
      ws.close(1008, "unusable post title");
      return;
    }
    if (!existsSync(config.VAULT_PATH)) {
      ws.close(1011, "vault missing");
      return;
    }

    const dir = sandboxDir(slug);
    mkdirSync(dir, { recursive: true });

    session = createTerminalSession(buildCookProfile(dir));

    const renderWatch = watchForRender({
      slug,
      onFound: (mp4Path) => {
        void (async () => {
          try {
            const assetId = await getAssetStore().put({ path: mp4Path }, "video", "video/mp4");
            const url = getAssetStore().publicUrl(assetId);
            ws.send(JSON.stringify({ type: "render", assetId, url }));
          } catch (err) {
            console.error("render capture failed", err);
          }
        })();
      },
    });

    session.onData((data) => {
      ws.send(JSON.stringify({ type: "output", data }));
    });

    session.onExit((code) => {
      renderWatch.stop();
      ws.send(JSON.stringify({ type: "exit", code }));
      ws.close();
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "input") {
          session?.write(msg.data);
        } else if (msg.type === "resize") {
          session?.resize(msg.cols, msg.rows);
        }
      } catch {
        // A malformed frame must not throw out of a ws "message" listener: this custom
        // server hosts the whole Next app in one process, and an uncaught throw here
        // would take the entire dev server down, not just this connection.
        ws.close(1008, "bad frame");
      }
    });

    ws.on("close", () => {
      renderWatch.stop();
      session?.kill();
    });
  } catch (err) {
    // Setup can throw or reject: the title lookup can hit a DB error or a locked
    // sqlite file, mkdirSync can hit EACCES, and spawning the pty can hit ENOENT if the
    // claude binary is missing. server.ts calls this as `void attachTerminal(ws, req)`,
    // so an unhandled rejection here would crash the whole process. Kill any session
    // that was already created and close the socket instead of letting it propagate.
    console.error("attachTerminal setup failed", err);
    session?.kill();
    if (ws.readyState === ws.OPEN) {
      ws.close(1011, "terminal setup failed");
    }
  }
}
