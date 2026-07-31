/**
 * Typed errors for the Instagram Graph API path (own-channel insights, V1 data
 * contracts §1). Mirrors `src/server/ig/errors.ts`'s shape deliberately: callers branch
 * on a stable `code`, never on a message substring.
 *
 * This is a SEPARATE error hierarchy from `IgError`. That one describes the instagrapi
 * burner-sidecar transport; this one describes the Graph API transport. They must never
 * merge, because the two credentials, the two accounts and the two failure surfaces are
 * unrelated, and a shared error type would invite a caller to handle a sidecar outage and
 * a Graph token problem as if they were the same event.
 */

export const GRAPH_ERROR_CODES = [
  /** No IG_GRAPH_TOKEN / IG_GRAPH_USER_ID configured. Not a failure of a call — a call
   *  was never attempted. */
  "GRAPH_NOT_CONFIGURED",
  "GRAPH_AUTH_FAILED",
  "GRAPH_RATE_LIMITED",
  "GRAPH_NETWORK",
  "GRAPH_UNKNOWN",
] as const;

export type GraphErrorCode = (typeof GRAPH_ERROR_CODES)[number];

const RETRYABLE: ReadonlySet<GraphErrorCode> = new Set<GraphErrorCode>(["GRAPH_RATE_LIMITED", "GRAPH_NETWORK"]);

export class GraphApiError extends Error {
  readonly code: GraphErrorCode;
  readonly retryable: boolean;

  constructor(code: GraphErrorCode, message: string, opts: { cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = "GraphApiError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }

  /** Message shown in the UI. Never contains the token — every string that reaches this
   *  class has already been through `redactToken`. */
  get userMessage(): string {
    switch (this.code) {
      case "GRAPH_NOT_CONFIGURED":
        return "No Graph API token configured. Add IG_GRAPH_TOKEN in .env.local and restart the dev server.";
      case "GRAPH_AUTH_FAILED":
        return "Instagram rejected the Graph API token. It may be expired or revoked — refresh it in .env.local.";
      case "GRAPH_RATE_LIMITED":
        return "Instagram is rate-limiting the Graph API. Try again later.";
      case "GRAPH_NETWORK":
        return "Network error talking to the Instagram Graph API.";
      default:
        return this.message;
    }
  }
}
