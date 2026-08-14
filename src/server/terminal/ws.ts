import { existsSync, mkdirSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { config } from "@/server/config";
import { nowIso } from "@/server/db";
import { getAssetStore } from "@/server/media/asset-store";
import { sandboxDir, slugify } from "@/server/studio/paths";
import { startCreateRunAction } from "@/server/actions/create-run-actions";
import { getCreateRun, getLatestCreateRunForPost, updateCreateRun } from "@/server/queries/create-runs";
import { buildCookProfile } from "./harness-profile";
import { getPlannedPostTitleById } from "./resolve-post";
import { pruneOldRenders, rendersRoot, watchForRender } from "./render-watch";
import { createTerminalSession } from "./session";
import { runOnCookQueue } from "./cook-queue";
import { type CookEntry, dropCookEntry, getCookEntry, putCookEntry, setCookEntryWs } from "./session-registry";

// A stale sandbox render sits around only long enough for its poll to pick it up and
// hand it to AssetStore; anything still there a day later is orphaned (a session that
// never exited cleanly, a crash mid-cook) and safe to sweep.
const RENDER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Sends only if a tab is currently attached and its socket is open. Output can arrive
 *  (pty data, a captured render, a run status change) while no tab has this post open
 *  -- the cook keeps running headless -- so every send on the cook's lifetime path
 *  routes through here instead of writing straight to a socket that may be null or
 *  already torn down. */
function sendIfAttached(entry: Pick<CookEntry, "ws">, payload: unknown): void {
  const socket = entry.ws;
  if (socket && socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

/**
 * Relays a per-post pty session over the websocket. The cwd is always server-computed
 * from the resolved post's title, never taken from the client, so a client cannot walk
 * a pty into an arbitrary directory by supplying a path.
 *
 * A cook outlives the socket that spawned it (D1 Task 5): the session, its watchdog,
 * its render watch, and the AbortController that owns its teardown all live in a
 * session-registry `CookEntry` keyed by postId, not in this function's closure. This
 * function either REATTACHes to an already-live cook (binds this socket as the
 * entry's current viewer, sends the current run status, spawns nothing) or SPAWNs a
 * new one and registers it. Either way, closing or erroring this socket only detaches
 * it from the entry -- it never kills a running cook.
 */
export async function attachTerminal(ws: WebSocket, req: IncomingMessage): Promise<void> {
  // Defensive no-op, registered immediately, before any `await`: the ws library
  // throws when a socket emits "error" with no listener attached, and this custom
  // server has no process-level uncaughtException handler, so an ordinary uncleaned
  // disconnect during the async lookups below (ECONNRESET, a tab or laptop closing)
  // would otherwise take down the whole single-process app. The real close/error
  // handling is wired further down, once we know whether this attach reattaches to a
  // live cook or spawns a new one; both listeners fire together on an actual error,
  // harmlessly.
  ws.on("error", () => {});

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

    // REATTACH: a cook is already live for this post (spawned by an earlier attach,
    // possibly for a tab that has since closed). Bind this socket to it instead of
    // spawning a second cook: no new session, no new create_run, no new watchdog or
    // render watch. Read the current run status before mutating anything, so a
    // failure here (e.g. a DB read error) falls through to the outer catch without
    // having touched the live entry.
    const existing = getCookEntry(postId);
    if (existing) {
      const latest = getLatestCreateRunForPost(postId);

      setCookEntryWs(existing, ws);

      // `existing.session` can still be null here: this reattach may have landed on a
      // placeholder entry whose spawn is still sitting in the concurrency queue (see
      // the fresh-spawn path below). Null-guarded so an input/resize frame that
      // arrives before the cook actually exists is dropped instead of throwing.
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "input") {
            existing.session?.write(msg.data);
          } else if (msg.type === "resize") {
            existing.session?.resize(msg.cols, msg.rows);
          }
        } catch {
          ws.close(1008, "bad frame");
        }
      });

      // DETACH ONLY: never kill the cook because a viewer's socket went away.
      const detach = () => {
        if (existing.ws === ws) setCookEntryWs(existing, null);
      };
      ws.on("close", detach);
      ws.on("error", detach);

      if (latest) {
        sendIfAttached(existing, { type: "run", runId: latest.id, status: latest.status });
      }
      return;
    }

    const dir = sandboxDir(slug);
    mkdirSync(dir, { recursive: true });

    // Best-effort sweep of orphaned render dirs from earlier sessions (a crash, a
    // watchdog kill) that never got cleaned up. Runs once per attach, not on a timer,
    // so it stays cheap and never competes with the poll below.
    pruneOldRenders(rendersRoot(), RENDER_MAX_AGE_MS);

    // One controller per SPAWN, not per socket, now owns the cook's teardown: it
    // aborts on session exit, a watchdog kill, a Stop-triggered process death, or a
    // synchronous spawn failure -- never because this socket closes or errors.
    const ac = new AbortController();

    // Reserves the postId SYNCHRONOUSLY, before the actual spawn is handed to
    // runOnCookQueue (which may defer it under concurrency pressure): `session` starts
    // null and the queued task below fills it in once it actually runs. Registering
    // here, not inside the queued task, is what closes the double-spawn window --
    // without it, two attaches for the same post that both land while both
    // concurrency slots are busy would each see no existing entry (getCookEntry above
    // runs before either one's task has had a turn) and each queue its own spawn.
    // Because the entry exists from this point on, any attach for this postId from
    // here forward -- queued or not -- takes the REATTACH branch above instead.
    const cookEntry: CookEntry = {
      session: null,
      watchdog: null,
      renderWatch: null,
      runId: null,
      renderCaptured: false,
      ac,
      ws,
    };
    putCookEntry(postId, cookEntry);

    // Attached before the cook is queued (which may wait behind other cooks at the
    // concurrency limit) so nothing sent while queued is lost. Null-guarded on
    // `cookEntry.session`, which stays null until the queued task below actually
    // spawns it.
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "input") {
          cookEntry.session?.write(msg.data);
        } else if (msg.type === "resize") {
          cookEntry.session?.resize(msg.cols, msg.rows);
        }
      } catch {
        // A malformed frame must not throw out of a ws "message" listener: this custom
        // server hosts the whole Next app in one process, and an uncaught throw here
        // would take the entire dev server down, not just this connection.
        ws.close(1008, "bad frame");
      }
    });

    // DETACH ONLY. If the cook has not actually spawned yet (`cookEntry.session` still
    // null -- this attach's queued task hasn't run, still waiting behind other cooks
    // at the concurrency limit), there is nothing running to detach from: abort
    // instead, so a tab closed before its cook ever started doesn't leak a queue slot
    // or a placeholder registry entry forever (the queued task's own aborted-check,
    // below, drops it once it gets its turn). Once the cook has spawned, this only
    // clears the currently-attached socket pointer, and only if it still points at
    // *this* socket -- a reattach may already have replaced it with a newer one, in
    // which case this is a no-op. It must never kill the session or abort the
    // controller while the cook is running.
    const handleDetach = () => {
      if (cookEntry.session === null) {
        ac.abort();
        return;
      }
      if (cookEntry.ws === ws) {
        setCookEntryWs(cookEntry, null);
      }
    };
    ws.on("close", handleDetach);
    ws.on("error", handleDetach);

    // The queued task holds its concurrency slot for the cook's whole real lifetime,
    // not just the spawn call: the returned promise only settles once the cook exits
    // (session onExit -> ac.abort()), the watchdog kills it, or the socket goes away
    // while still queued (handleDetach -> ac.abort() before the cook ever spawned). A
    // cook that never gets to spawn (ws closed while still queued) still resolves and
    // frees its slot instead of leaking it.
    void runOnCookQueue(
      () =>
        new Promise<void>((resolve) => {
          if (ac.signal.aborted) {
            // The socket closed or errored while this task was waiting in the queue:
            // never spawn a cook nobody can see. Drop the placeholder this attach
            // reserved (identity-checked, so this is a no-op if a newer registration
            // already replaced it) and free the slot.
            dropCookEntry(postId, cookEntry);
            resolve();
            return;
          }

          try {
            const session = createTerminalSession(buildCookProfile(dir));
            cookEntry.session = session;

            // Fire-and-forget: claims a create_runs row for this cook. Deliberately not
            // awaited -- the executor above must stay synchronous so the existing
            // onData/onExit/watchdog wiring below is in place before anything can race
            // it. The `ac.signal.aborted` guard covers the (rare) case where the cook
            // already ended by the time this resolves: if so, this leaves the row
            // `running` with no pid rather than writing into a dropped entry, and
            // reconcileOrphanCreateRuns cleans it up on the next server start.
            void startCreateRunAction({ postId, slug }).then((res) => {
              if (ac.signal.aborted || !res.ok) return;
              cookEntry.runId = res.runId;
              const patch: Parameters<typeof updateCreateRun>[1] = { heartbeatAt: nowIso() };
              const pid = session.pid;
              if (typeof pid === "number") patch.pid = pid;
              updateCreateRun(cookEntry.runId, patch);
              sendIfAttached(cookEntry, { type: "run", runId: cookEntry.runId, status: "running" });
            });

            // Cooks are human-gated and can sit idle a long time waiting on input, so
            // this is a hung-process safety net only, not a cook time limit: it must
            // stay long (config defaults to 6h) and must not become gate-aware here.
            cookEntry.watchdog = setTimeout(() => {
              session.kill();
              cookEntry.ws?.close(1011, "cook watchdog");
            }, config.COOK_WATCHDOG_MS);

            cookEntry.renderWatch = watchForRender({
              slug,
              onFound: (mp4Path) => {
                // Set synchronously, before the async capture below, so a session exit
                // that races the asset-store write still sees a render as "found" and
                // does not mark the run failed underneath it.
                cookEntry.renderCaptured = true;
                void (async () => {
                  try {
                    const assetId = await getAssetStore().put({ path: mp4Path }, "video", "video/mp4");
                    const url = getAssetStore().publicUrl(assetId);
                    sendIfAttached(cookEntry, { type: "render", assetId, url });
                    if (cookEntry.runId) {
                      updateCreateRun(cookEntry.runId, {
                        status: "success",
                        finishedAt: nowIso(),
                        renderAssetId: assetId,
                      });
                      sendIfAttached(cookEntry, { type: "run", runId: cookEntry.runId, status: "success" });
                    }
                  } catch (err) {
                    console.error("render capture failed", err);
                  }
                })();
              },
            });

            session.onData((data) => {
              sendIfAttached(cookEntry, { type: "output", data });
            });

            session.onExit((code) => {
              ac.abort();
              sendIfAttached(cookEntry, { type: "exit", code });
              cookEntry.ws?.close();

              // No render landed before the process exited: mark the run failed, unless
              // it already reached a terminal status another way (Stop already set it
              // to `canceled`, or the render-capture path above already set `success`
              // in the race window between renderCaptured flipping and this handler
              // running). Reading the row fresh, rather than trusting local state,
              // is what avoids clobbering a Stop that raced this exit.
              if (cookEntry.runId && !cookEntry.renderCaptured) {
                const current = getCreateRun(cookEntry.runId);
                if (current && (current.status === "running" || current.status === "waiting")) {
                  updateCreateRun(cookEntry.runId, {
                    status: "failed",
                    finishedAt: nowIso(),
                    errorMessage: `cook session ended without a render (exit code ${code})`,
                  });
                  sendIfAttached(cookEntry, { type: "run", runId: cookEntry.runId, status: "failed" });
                }
              }
            });

            // The one place that tears down a live cook: fires on a normal exit (via
            // the onExit -> ac.abort() above) or a watchdog kill (which kills the
            // process, which fires onExit). Frees the queue slot.
            ac.signal.addEventListener(
              "abort",
              () => {
                if (cookEntry.watchdog) {
                  clearTimeout(cookEntry.watchdog);
                  cookEntry.watchdog = null;
                }
                cookEntry.renderWatch?.stop();
                dropCookEntry(postId, cookEntry);
                session.kill();
                resolve();
              },
              { once: true },
            );
          } catch (err) {
            // Spawning the pty can throw synchronously (ENOENT if the claude binary is
            // missing). This runs inside the queued task, not attachTerminal's own
            // try/catch below, so it needs its own handling. The
            // `ac.signal.addEventListener("abort", ...)` above is only reached after
            // this whole block succeeds, so if a throw lands here the watchdog and
            // render watch may already be armed (e.g. watchForRender threw after the
            // watchdog's setTimeout succeeded) with nothing yet registered to clear
            // them -- clear them directly here rather than relying on an abort
            // listener that may not exist yet, drop the placeholder/partial
            // registration (identity-checked), kill any partial session, mark the
            // controller aborted, close the socket, and resolve so the queue slot
            // frees instead of leaking.
            console.error("attachTerminal cook setup failed", err);
            if (cookEntry.watchdog) {
              clearTimeout(cookEntry.watchdog);
              cookEntry.watchdog = null;
            }
            cookEntry.renderWatch?.stop();
            dropCookEntry(postId, cookEntry);
            ac.abort();
            cookEntry.session?.kill();
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
    // sqlite file, mkdirSync can hit EACCES, and the reattach branch's run-status read
    // can hit a DB error. server.ts calls this as `void attachTerminal(ws, req)`, so
    // an unhandled rejection here would crash the whole process. Nothing has spawned
    // or registered a cook by any point this catch can be reached (spawning happens
    // entirely inside the queued task's own try/catch above, which never lets an
    // exception escape), so there is nothing here to kill or drop -- just close the
    // socket.
    console.error("attachTerminal setup failed", err);
    if (ws.readyState === ws.OPEN) {
      ws.close(1011, "terminal setup failed");
    }
  }
}
