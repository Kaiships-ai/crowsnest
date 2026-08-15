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
  /** Timestamp (Date.now()) of the most recent pty output. Reset on every
   *  session.onData frame; the waiting-idle check compares against this rather than
   *  reading the DB row on every data event. */
  lastOutputAt: number;
  /** Local mirror of "the run is sitting at a human gate", cheaper to check on every
   *  onData frame than a DB read. Set true by the waiting-idle check when output has
   *  been quiet past WAITING_IDLE_MS (which also clears `watchdog`); set false the
   *  moment output resumes (which re-arms it). Kept in lockstep with `watchdog` so the
   *  two never say different things: watchdog present <=> not waiting. */
  waiting: boolean;
  /** Handle for the recurring waiting-idle check, armed once at spawn alongside the
   *  watchdog and render watch and cleared on every cook-end path (never re-created),
   *  so there is exactly one of these per cook regardless of how many times the run
   *  flips between running and waiting. */
  waitingCheck: NodeJS.Timeout | null;
  /**
   * Client input that arrived before the cook could take it, in arrival order.
   *
   * The Cook button injects `/ksa:cooking\r` the instant it is clicked, and there are
   * two windows where that used to be thrown away: `session` is still null (the spawn is
   * sitting behind other cooks at the concurrency limit), or the pty exists but the
   * claude REPL has not printed its prompt yet and would swallow the keystrokes. Both
   * are covered by holding the bytes here and writing them once the session's first
   * output proves the REPL is listening.
   *
   * Kept on the ENTRY rather than in an attach's closure on purpose: a reattach can land
   * on a placeholder whose spawn has not run yet (see attachTerminal's reattach branch),
   * and a per-attach queue would leave that socket's input dropped, which is the same bug
   * one layer over.
   */
  inputQueue: string[];
  /** False until the cook's first output. While false every input frame is queued
   *  instead of written; the flush flips it true and drains the queue in order. */
  inputReady: boolean;
  /** Fallback flush. A cook that starts silently would otherwise hold the queue
   *  forever, so the flush is armed on a timer as well as on first output; whichever
   *  fires first clears the other. */
  inputFlush: NodeJS.Timeout | null;
}

/** Ceiling on queued input, in frames. Far above any real pre-spawn burst (the Cook
 *  button sends one), low enough that a client cannot make the server hold arbitrary
 *  memory by typing at a cook that never spawns. */
export const MAX_QUEUED_INPUT = 256;

/**
 * Writes client input to the cook, or holds it until the cook can take it.
 *
 * The old code was `entry.session?.write(data)`, which silently discarded anything that
 * arrived early. That is what lost the Cook button's injected command.
 */
export function writeCookInput(entry: CookEntry, data: string): void {
  if (entry.session && entry.inputReady) {
    entry.session.write(data);
    return;
  }
  if (entry.inputQueue.length >= MAX_QUEUED_INPUT) {
    // Logged rather than swallowed: dropping input silently is the bug being fixed, and
    // hitting this ceiling means something is wrong upstream, not that a user typed fast.
    console.warn(`cook input queue full (${MAX_QUEUED_INPUT} frames); dropping further input until the cook is ready`);
    return;
  }
  entry.inputQueue.push(data);
}

/**
 * Marks the cook ready for input and drains whatever queued up, in arrival order.
 *
 * Called from the session's first output (the REPL prompt) and from the fallback timer.
 * Idempotent: a second call finds an empty queue and writes nothing.
 */
export function flushCookInput(entry: CookEntry): void {
  const session = entry.session;
  // Nothing to flush into. Cannot happen through either real caller (both run after the
  // spawn assigned `session`, and the fallback timer is armed there too, so it cannot
  // fire earlier), but returning without setting `inputReady` keeps the invariant honest:
  // ready must never be true while there is no session, or the write path would take the
  // direct branch and drop the bytes.
  if (!session) return;

  if (entry.inputFlush) {
    clearTimeout(entry.inputFlush);
    entry.inputFlush = null;
  }
  entry.inputReady = true;
  const queued = entry.inputQueue;
  entry.inputQueue = [];
  for (const chunk of queued) {
    session.write(chunk);
  }
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
