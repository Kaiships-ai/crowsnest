import { graphClient, type GraphTokenStatus } from "./client";

/**
 * Server-side cache of the Graph token check, so a My reels render or a reel picker click
 * does not make a live Graph call every time. Dropped when a token secret is saved or
 * cleared, and when a measurement hits an auth failure; a measurement run also writes its
 * own outcome here (ok, or a permission refusal). "Check connection" stays live.
 * Kept on globalThis: tsx server.ts (the scheduler) and Next's bundle (actions, renders)
 * each load their own copy of this module in the same process, and must share one cache.
 * ponytail: one process; fine for a single-user local app.
 */
const TTL_MS = 5 * 60_000;
/** rate_limited, network and unknown can clear on their own, so they are rechecked soon. */
const TRANSIENT_TTL_MS = 30_000;
const DEFINITIVE: ReadonlySet<GraphTokenStatus["state"]> = new Set(["ok", "not_configured", "auth_failed", "permission_denied"]);
const shared = globalThis as { __crowsnestTokenStatus?: { cached: { status: GraphTokenStatus; at: number } | null } };
const state = (shared.__crowsnestTokenStatus ??= { cached: null });

export async function cachedTokenStatus(now: number = Date.now()): Promise<GraphTokenStatus> {
  const cached = state.cached;
  if (cached && now - cached.at < (DEFINITIVE.has(cached.status.state) ? TTL_MS : TRANSIENT_TTL_MS)) return cached.status;
  const status = await graphClient.checkToken();
  state.cached = { status, at: now };
  return status;
}

export function rememberTokenStatus(status: GraphTokenStatus, now: number = Date.now()): void {
  state.cached = { status, at: now };
}

export function invalidateTokenStatus(): void {
  state.cached = null;
}
