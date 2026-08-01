import type { getIgStatusAction } from "@/server/actions/ig-actions";

/**
 * The dependency status surface (v1-to-product-backlog.html A4): before Kai clicks
 * anything, say which of the two out-of-process dependencies — the Instagram sidecar
 * and the LLM backend — is actually usable. Both reviews that flagged A4 found the
 * same shape of problem: nothing auto-starts either one, and nothing on the dashboard
 * says so until a click fails.
 *
 * This module is the pure classification layer, same split as `sync/failure-strip-
 * view.ts` and `remix/run-log-view.ts`: no React, no fetching, just "given the result
 * a real action already returned, what does that mean." It exists because this repo's
 * vitest runs in node with no jsdom — a plain function is the only thing here that
 * gets test coverage at all.
 *
 * Deliberately reuses existing actions rather than adding new ones:
 *  - `getIgStatusAction` (ig-actions.ts) for the sidecar — an unreachable process comes
 *    back as `ok: false, code: "IG_SERVICE_DOWN"`, a state distinct from every other
 *    failure that action can return (see its own module doc, rule 3).
 *  - `hasLlmKey()` (llm/client.ts) for whether a key is configured at all, plus
 *    `testAnthropicKeyAction` (settings-actions.ts) — the Settings page's own "Test"
 *    button — for whether the configured backend actually answers. That second part
 *    matters because it is not implied by the first: verified against this machine
 *    today, `LLM_BASE_URL` points at a local proxy that is up (the port accepts
 *    connections) while every model behind it fails (expired routes, retired models).
 *    A surface that only checked "is a key set" or "does the port answer" would call
 *    that state healthy.
 *
 *    It would be tempting to stop there and treat a passing `testAnthropicKeyAction`
 *    ping as proof the model works, since it's a real `count_tokens` call (cost: $0)
 *    through the actual configured client. Verified directly against the running proxy
 *    while building this: it does not prove that. `POST /v1/messages/count_tokens`
 *    answered `200` by tokenizing locally, without forwarding to the configured model
 *    at all, while `POST /v1/messages` — the endpoint Hook/Style/Script actually call —
 *    answered `410 Gone` for the same model. A ping that passes only proves the proxy
 *    is up and answering; it does not, in proxy mode, prove generation works. That gap
 *    is exactly the false-green class this surface exists to close, so `classifyLlmStatus`
 *    below never reports proxy-mode ping success as `"up"` — see `"reachable_unverified"`.
 *    Direct-to-Anthropic mode has no such gap: the real API's `count_tokens` endpoint
 *    authenticates the key and validates the model the same way a generation call would,
 *    which is why Settings' own "Test" button already treats that case as proof enough.
 */

export type IgStatusResult = Awaited<ReturnType<typeof getIgStatusAction>>;

/** Mirrors `testAnthropicKeyAction`'s return shape (settings-actions.ts) structurally
 *  rather than importing it — that file is `"use server"`, so importing its type would
 *  pull a server-actions module into this plain one for a two-field shape neither type
 *  needs to see elsewhere. */
export type LlmPingResult = { ok: true } | { ok: false; error: string };

/** Sentinel for "the ping didn't finish in time" — see `withTimeout` below. Kept as a
 *  distinct value (not folded into `LlmPingResult`) so a caller can never confuse
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

export type LlmState = "up" | "reachable_unverified" | "down" | "not_configured" | "unknown";

export interface LlmStatus {
  state: LlmState;
  /** The exact reason, when there is one to give — `testAnthropicKeyAction`'s own
   *  message (itself `llm/error-message.ts`'s mapping of the real SDK error), never
   *  paraphrased. Null for "up" and "not_configured". */
  detail: string | null;
  /** `LLM_BASE_URL`, read once and passed in — null means no override is set, so
   *  requests go straight to the real Anthropic API rather than a local router. Carried
   *  through every state so "where it looked" is always answerable, not just on failure. */
  proxyUrl: string | null;
  /** Whether the something that answered (or didn't) is the local proxy rather than the
   *  real API — same test as `isCompatMode()` (llm/client.ts), passed in rather than
   *  re-derived so this module never reads `process.env` itself. */
  routedThroughProxy: boolean;
  /**
   * True when the ping got an actual response — any response, including an error
   * status — as opposed to nothing answering at all. Null when there's no ping result
   * to read one off (`not_configured`, `unknown`). This is the field the false-green
   * risk lives in: a proxy that is up but serving a dead model reads `state: "down"`
   * with `reachable: true`, never as though nothing were wrong.
   */
  reachable: boolean | null;
}

/**
 * The exact string `llm/error-message.ts`'s `llmErrorMessage()` returns for
 * `Anthropic.APIConnectionError` — the one branch that means the transport itself
 * failed (refused connection, DNS failure, timeout before any HTTP response), as
 * opposed to every other branch, which means a response came back and it happened to
 * be an error (bad key, dead model route, rate limit). String-matched against
 * `testAnthropicKeyAction`'s already-mapped message rather than a new structured error
 * code, because that mapping is shared server code this surface doesn't own or want to
 * fork. If that string ever changes, this falls back to treating the failure as
 * "reachable unknown" rather than silently mis-classifying — see the `?? true` below;
 * an over-cautious "reachable" reads as the honest side of that failure mode, since it
 * never turns a real outage into a false green.
 */
const CONNECTION_FAILURE_MESSAGE = "Network error reaching Claude";

export interface ClassifyLlmInput {
  hasKey: boolean;
  proxyUrl: string | null;
  routedThroughProxy: boolean;
  ping: LlmPingResult | typeof PING_TIMED_OUT;
}

export function classifyLlmStatus(input: ClassifyLlmInput): LlmStatus {
  const { proxyUrl, routedThroughProxy } = input;

  if (!input.hasKey) {
    return { state: "not_configured", detail: null, proxyUrl, routedThroughProxy, reachable: null };
  }
  if (input.ping === PING_TIMED_OUT) {
    return {
      state: "unknown",
      detail: "The check didn't get a response in time.",
      proxyUrl,
      routedThroughProxy,
      reachable: null,
    };
  }
  if (input.ping.ok) {
    // Verified against the real proxy this app is pointed at today: its
    // `/v1/messages/count_tokens` route (what `ping()` calls) answers 200 by tokenizing
    // locally, without forwarding to the configured model at all — while the same
    // model's real `/v1/messages` call (what Hook/Style/Script actually send) returns
    // 410 Gone. So in proxy mode, a passing ping proves the proxy is up and answering,
    // never that the model behind it generates anything — the exact "proxy answers" vs
    // "model works" gap this surface exists to keep separate. Direct-to-Anthropic mode
    // has no such gap: the real API's `count_tokens` endpoint authenticates the key and
    // validates the model in the same way a generation call would, which is why
    // Settings' own "Test" button already treats that case as proof enough.
    return routedThroughProxy
      ? { state: "reachable_unverified", detail: null, proxyUrl, routedThroughProxy, reachable: true }
      : { state: "up", detail: null, proxyUrl, routedThroughProxy, reachable: true };
  }
  const reachable = input.ping.error !== CONNECTION_FAILURE_MESSAGE;
  return { state: "down", detail: input.ping.error, proxyUrl, routedThroughProxy, reachable };
}

/** Both dependencies usable right now — the one condition under which the panel stays
 *  quiet (v1-to-product-backlog.html A4's brief: visible without hunting, but must not
 *  shout when everything is fine). */
export function bothHealthy(sidecar: SidecarStatus, llm: LlmStatus): boolean {
  return sidecar.state === "up" && llm.state === "up";
}

/**
 * Races a promise against a plain timer. Used to keep the dashboard's own load from
 * hanging on a fully unreachable LLM backend — the Anthropic SDK's default transport
 * timeout is far longer than a page load should ever wait, and a truly dead connection
 * (as opposed to a fast-failing 401/410 response) can take that long to give up. A
 * timeout here reports as `PING_TIMED_OUT` — "inconclusive," never coerced into "down,"
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
        // testAnthropicKeyAction never throws (it's a server action that returns a
        // result), but a defensive fallback here still reads as "inconclusive" rather
        // than crashing the dashboard on some future change to that contract.
        clearTimeout(timer);
        resolve(PING_TIMED_OUT);
      },
    );
  });
}

/** How long the dashboard waits for the live model-backend check before giving up and
 *  showing "unknown" instead. Generous enough for a real round trip through a local
 *  proxy, short enough that a fully dead connection never makes the dashboard feel
 *  broken. */
export const LLM_PING_TIMEOUT_MS = 6000;
