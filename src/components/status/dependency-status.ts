import type { getIgStatusAction } from "@/server/actions/ig-actions";
import type { GraphTokenStatus } from "@/server/graph/client";

/**
 * The dependency status surface (v1-to-product-backlog.html A4): before Kai clicks
 * anything, say which of the two out-of-process dependencies, the Instagram sidecar and
 * the Instagram Graph API, is actually usable.
 *
 * Pure classification only: no React, no fetching, just "given the result a real action
 * already returned, what does that mean."
 *
 *  - `getIgStatusAction` (ig-actions.ts) for the sidecar: an unreachable process comes
 *    back as `ok: false, code: "IG_SERVICE_DOWN"`.
 *  - `cachedTokenStatus` (graph/token-status.ts) for Graph, the same check the Settings
 *    page's Graph section shows.
 */

export type IgStatusResult = Awaited<ReturnType<typeof getIgStatusAction>>;

/** Sentinel for "the ping didn't finish in time" — see `withTimeout` below. Kept as a
 *  distinct value so a caller can never confuse
 *  "we tried and it failed" with "we gave up waiting," which read very differently on
 *  screen: the first is a real down signal, the second is honestly inconclusive. */
export const PING_TIMED_OUT = "timed_out" as const;

export type SidecarState = "up" | "down" | "error";

export interface SidecarStatus {
  state: SidecarState;
  /** The action's own message, verbatim — never invented here. Null only for "up". */
  detail: string | null;
}

/** The one command that starts the sidecar (package.json's `ig:service` script). A
 *  literal string, not derived from anything, because it is the one thing about this
 *  dependency that never changes regardless of why it's down. */
export const SIDECAR_START_COMMAND = "npm run ig:service";

/**
 * `IG_SERVICE_DOWN` is the one code `getIgStatusAction` returns that means "the process
 * isn't running" — see that file's `assertHealthShape`/module doc. Every other failure
 * code (e.g. `IG_DRIFT`) is a real problem too, but starting the sidecar wouldn't fix
 * it, so it gets its own state rather than the same fix-it copy.
 */
export function classifySidecarStatus(result: IgStatusResult): SidecarStatus {
  if (result.ok) return { state: "up", detail: null };
  if (result.code === "IG_SERVICE_DOWN") return { state: "down", detail: result.error };
  return { state: "error", detail: result.error };
}

export type GraphState = "up" | "not_configured" | "down" | "unknown";

export interface GraphStatus {
  state: GraphState;
  /** The token check's own message, verbatim. Null when it gave none. */
  detail: string | null;
}

export function classifyGraphStatus(token: GraphTokenStatus | typeof PING_TIMED_OUT): GraphStatus {
  if (token === PING_TIMED_OUT) return { state: "unknown", detail: "The check didn't get a response in time." };
  switch (token.state) {
    case "ok":
      return { state: "up", detail: null };
    case "not_configured":
      return { state: "not_configured", detail: token.message };
    case "rate_limited":
    case "unknown":
      return { state: "unknown", detail: token.message };
    default:
      return { state: "down", detail: token.message };
  }
}

/** Both dependencies usable right now, the one condition under which the panel stays
 *  quiet (A4's brief: visible without hunting, but must not shout when all is fine). */
export function bothHealthy(sidecar: SidecarStatus, graph: GraphStatus): boolean {
  return sidecar.state === "up" && graph.state === "up";
}

/**
 * Races a promise against a plain timer, so a dead network never stalls the dashboard's
 * own load. A timeout here reports as `PING_TIMED_OUT` — "inconclusive," never coerced into "down,"
 * since the backend might answer a second later and this check simply didn't wait for it.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof PING_TIMED_OUT> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(PING_TIMED_OUT), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        // A rejected check reads as "inconclusive" rather than crashing the dashboard.
        clearTimeout(timer);
        resolve(PING_TIMED_OUT);
      },
    );
  });
}

/** How long the dashboard waits for the live Graph check before showing "unknown". */
export const PING_TIMEOUT_MS = 6000;
