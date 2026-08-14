import type { WebSocket } from "ws";
import type { TerminalSession } from "./session";

/**
 * One entry per postId, live for as long as its cook (pty session) is actually
 * running -- independent of any browser tab (D1 Task 5). E1 tied a cook's session,
 * watchdog, render watch, and teardown controller to the socket that spawned it, so
 * closing the tab killed the cook. Here those four live in a registry entry keyed by
 * postId instead, and `ws` is whichever socket is *currently* attached to watch it --
 * swapped on reattach, `null` when no tab has this post open. Output produced while
 * `ws` is null is simply dropped, not buffered: a reattach only recovers the current
 * run status (via `getLatestCreateRunForPost`), not replayed terminal output.
 *
 * `session` starts `null`: attachTerminal reserves the postId by registering a
 * placeholder entry synchronously, before the actual spawn is queued (which may be
 * deferred under concurrency pressure), so a second attach for the same post can never
 * land in the window between "decided to spawn" and "actually spawned" and race a
 * duplicate cook into existence. The queued task fills `session` in once it runs.
 */
export interface CookEntry {
  session: TerminalSession | null;
  watchdog: NodeJS.Timeout | null;
  renderWatch: { stop: () => void } | null;
  /** The create_runs row id for this cook, set once startCreateRunAction resolves. */
  runId: string | null;
  /** Guards the exit handler so a normal exit right after a successful render does
   *  not clobber the "success" status the render-watch path already wrote. */
  renderCaptured: boolean;
  /** Owns the cook's teardown -- aborts on session exit, a watchdog kill, a
   *  Stop-triggered process death, or a synchronous spawn failure. It must never
   *  abort because the attached socket merely closed or errored; that only detaches. */
  ac: AbortController;
  ws: WebSocket | null;
}

const registry = new Map<string, CookEntry>();

export function getCookEntry(postId: string): CookEntry | undefined {
  return registry.get(postId);
}

export function putCookEntry(postId: string, entry: CookEntry): void {
  registry.set(postId, entry);
}

/** Identity-checked: only deletes when the registry still holds *this exact* entry.
 *  Without the check, a stale teardown (e.g. a placeholder that lost a race and was
 *  never the one actually spawned, or any other delayed cleanup racing a newer
 *  registration for the same postId) could delete a different, still-live cook's
 *  entry out from under it. */
export function dropCookEntry(postId: string, entry: CookEntry): void {
  if (registry.get(postId) === entry) {
    registry.delete(postId);
  }
}

/** Swaps the socket currently attached to a live cook. Used on reattach (a new tab
 *  takes over) and on detach (the attached tab's ws closed or errored) so every write
 *  to `entry.ws` goes through one named path instead of ad hoc field mutation. */
export function setCookEntryWs(entry: CookEntry, ws: WebSocket | null): void {
  entry.ws = ws;
}
