import { graphClient, type GraphTokenStatus } from "./client";

/**
 * Server-side cache of the Graph token check, so a My reels render or a reel picker click
 * does not make a live Graph call every time. Dropped when a token secret is saved or
 * cleared, and when a measurement hits an auth failure; a measurement run also writes its
 * own outcome here (ok, or a permission refusal). "Check connection" stays live.
 * ponytail: module-level, one process; fine for a single-user local app.
 */
const TTL_MS = 5 * 60_000;
/** rate_limited, network and unknown can clear on their own, so they are rechecked soon. */
const TRANSIENT_TTL_MS = 30_000;
const DEFINITIVE: ReadonlySet<GraphTokenStatus["state"]> = new Set(["ok", "not_configured", "auth_failed", "permission_denied"]);
let cached: { status: GraphTokenStatus; at: number } | null = null;

export async function cachedTokenStatus(now: number = Date.now()): Promise<GraphTokenStatus> {
  if (cached && now - cached.at < (DEFINITIVE.has(cached.status.state) ? TTL_MS : TRANSIENT_TTL_MS)) return cached.status;
  const status = await graphClient.checkToken();
  cached = { status, at: now };
  return status;
}

export function rememberTokenStatus(status: GraphTokenStatus, now: number = Date.now()): void {
  cached = { status, at: now };
}

export function invalidateTokenStatus(): void {
  cached = null;
}
