import { existsSync, mkdirSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { config } from "@/server/config";
import { getAssetStore } from "@/server/media/asset-store";
import { sandboxDir, slugify } from "@/server/studio/paths";
import { buildCookProfile } from "./harness-profile";
import { getPlannedPostTitleById } from "./resolve-post";
import { pruneOldRenders, rendersRoot, watchForRender } from "./render-watch";
import { createTerminalSession } from "./session";
import { runOnCookQueue } from "./cook-queue";

// A stale sandbox render sits around only long enough for its poll to pick it up and
// hand it to AssetStore; anything still there a day later is orphaned (a session that
// never exited cleanly, a crash mid-cook) and safe to sweep.
const RENDER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
  let renderWatch: { stop: () => void } | null = null;
  let watchdog: NodeJS.Timeout | null = null;

  // A named helper, not an inline `session?.kill()`, on purpose: TypeScript's control
  // flow narrowing treats `session = createTerminalSession(...)` inside the queued
  // task's nested closure (below) as if it could run synchronously as part of the
  // `runOnCookQueue(...)` call, which then makes an inline `session?.kill()` read
  // right after that call site (in the outer catch block) spuriously narrow to
  // `never`. Routing every read through this indirection sidesteps that false
  // positive without an `as` cast.
  const killSession = (): void => {
    session?.kill();
  };

  // One controller per attach owns both timers, so every teardown path (session exit,
  // ws close, ws error, setup failure) converges on a single `ac.abort()` instead of
  // each repeating "stop the poll, clear the watchdog" and risking one of them drifting
  // out of sync as the handlers evolve. The listener reads `watchdog`/`renderWatch`
  // through the closure at fire time, so it works regardless of whether abort() is
  // called before or after either one exists (e.g. a setup failure before the session
  // spawns).
  const ac = new AbortController();
  ac.signal.addEventListener(
    "abort",
    () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      renderWatch?.stop();
    },
    { once: true },
  );

  ws.on("error", () => {
    ac.abort();
    killSession();
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

    // Best-effort sweep of orphaned render dirs from earlier sessions (a crash, a
    // watchdog kill) that never got cleaned up. Runs once per attach, not on a timer,
    // so it stays cheap and never competes with the poll below.
    pruneOldRenders(rendersRoot(), RENDER_MAX_AGE_MS);

    // Attached before the cook is queued (which may wait behind other cooks at the
    // concurrency limit) so nothing sent while queued is lost. Both handlers
    // null-guard on `session`, which stays null until the queued task below actually
    // spawns it.
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
      ac.abort();
      killSession();
    });

    // The queued task holds its concurrency slot for the whole cook lifetime, not just
    // the spawn call: the returned promise only settles once the cook exits (session
    // onExit -> ac.abort()) or the socket goes away while queued/running (ws close or
    // error -> ac.abort()). Both converge on the same "abort" listener below, so a cook
    // that never gets to spawn (ws closed while still queued) still resolves and frees
    // its slot instead of leaking it.
    void runOnCookQueue(
      () =>
        new Promise<void>((resolve) => {
          if (ac.signal.aborted) {
            // The socket closed or errored while this task was waiting in the queue:
            // never spawn a cook nobody can see, just free the slot.
            resolve();
            return;
          }

          try {
            session = createTerminalSession(buildCookProfile(dir));

            // Cooks are human-gated and can sit idle a long time waiting on input, so
            // this is a hung-process safety net only, not a cook time limit: it must
            // stay long (config defaults to 6h) and must not become gate-aware here.
            watchdog = setTimeout(() => {
              session?.kill();
              ws.close(1011, "cook watchdog");
            }, config.COOK_WATCHDOG_MS ?? 21_600_000);

            renderWatch = watchForRender({
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
              ac.abort();
              ws.send(JSON.stringify({ type: "exit", code }));
              ws.close();
            });

            // The one place that frees the queue slot: fires on a normal exit (via the
            // onExit -> ac.abort() above) and on an external teardown (ws close/error,
            // or the setup catch block below), whichever comes first.
            ac.signal.addEventListener(
              "abort",
              () => {
                session?.kill();
                resolve();
              },
              { once: true },
            );
          } catch (err) {
            // Spawning the pty can throw synchronously (ENOENT if the claude binary is
            // missing). This runs inside the queued task, not attachTerminal's own
            // try/catch below, so it needs its own handling: kill any partial session,
            // abort to clear the watchdog and render poll, close the socket, and
            // resolve so the queue slot frees instead of leaking.
            console.error("attachTerminal cook setup failed", err);
            ac.abort();
            session?.kill();
            if (ws.readyState === ws.OPEN) {
              ws.close(1011, "terminal setup failed");
            }
            resolve();
          }
        }),
    ).catch((err) => {
      // runOnCookQueue only rejects if the executor above rejects, which it no longer
      // does (every path calls resolve()); this is a last-resort net, not an expected
      // path.
      console.error("cook queue task failed", err);
    });
  } catch (err) {
    // Setup can throw or reject: the title lookup can hit a DB error or a locked
    // sqlite file, mkdirSync can hit EACCES, and spawning the pty can hit ENOENT if the
    // claude binary is missing. server.ts calls this as `void attachTerminal(ws, req)`,
    // so an unhandled rejection here would crash the whole process. Kill any session
    // that was already created and close the socket instead of letting it propagate.
    console.error("attachTerminal setup failed", err);
    ac.abort();
    killSession();
    if (ws.readyState === ws.OPEN) {
      ws.close(1011, "terminal setup failed");
    }
  }
}
