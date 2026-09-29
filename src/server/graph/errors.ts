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
  /** The token works but lacks a permission or scope (Graph codes 10, 200-299). */
  "GRAPH_PERMISSION_DENIED",
  "GRAPH_RATE_LIMITED",
  "GRAPH_NETWORK",
  /** Reel container creation/publish failed, or a container's status_code went
   *  FINISHED->ERROR/EXPIRED while polling (publish, B2). */
  "GRAPH_CONTAINER_FAILED",
  /** Reel container never reached FINISHED within the bounded poll (publish, B2). */
  "GRAPH_TIMEOUT",
  "GRAPH_UNKNOWN",
] as const;

export type GraphErrorCode = (typeof GRAPH_ERROR_CODES)[number];

const RETRYABLE: ReadonlySet<GraphErrorCode> = new Set<GraphErrorCode>(["GRAPH_RATE_LIMITED", "GRAPH_NETWORK", "GRAPH_TIMEOUT"]);

/** Coarser bucket than `GraphErrorCode`, for callers (the publish service/scheduler)
 *  that just need to branch/store "what kind of failure" without knowing every code. */
export type GraphErrorClass = "auth" | "container" | "timeout" | "rate_limit" | "unknown";

const ERROR_CLASS_BY_CODE: Record<GraphErrorCode, GraphErrorClass> = {
  GRAPH_NOT_CONFIGURED: "auth",
  GRAPH_AUTH_FAILED: "auth",
  GRAPH_PERMISSION_DENIED: "auth",
  GRAPH_RATE_LIMITED: "rate_limit",
  GRAPH_NETWORK: "unknown",
  GRAPH_CONTAINER_FAILED: "container",
  GRAPH_TIMEOUT: "timeout",
  GRAPH_UNKNOWN: "unknown",
};

export class GraphApiError extends Error {
  readonly code: GraphErrorCode;
  readonly retryable: boolean;

  constructor(code: GraphErrorCode, message: string, opts: { cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = "GraphApiError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }

  /** Stable bucket for storage/branching (e.g. `plannedPosts.errorClass`). Never a raw
   *  message — see the module doc's separate-hierarchy rule. */
  get errorClass(): GraphErrorClass {
    return ERROR_CLASS_BY_CODE[this.code];
  }

  /** Message shown in the UI. Never contains the token — every string that reaches this
   *  class has already been through `redactToken`. */
  get userMessage(): string {
    switch (this.code) {
      case "GRAPH_NOT_CONFIGURED":
        return "No Graph API token configured. Add IG_GRAPH_TOKEN in .env.local and restart the dev server.";
      case "GRAPH_AUTH_FAILED":
        return "Instagram rejected the Graph API token. It may be expired or revoked — refresh it in .env.local.";
      case "GRAPH_PERMISSION_DENIED":
        return "The Graph API token is missing a permission this app needs. Generate a new token with the insights permissions and update it.";
      case "GRAPH_RATE_LIMITED":
        return "Instagram is rate-limiting the Graph API. Try again later.";
      case "GRAPH_NETWORK":
        return "Network error talking to the Instagram Graph API.";
      case "GRAPH_CONTAINER_FAILED":
        return "Instagram could not process the Reel video for publishing.";
      case "GRAPH_TIMEOUT":
        return "Instagram did not finish processing the Reel video in time.";
      default:
        return this.message;
    }
  }
}
