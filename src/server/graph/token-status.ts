import { graphClient, type GraphTokenStatus } from "./client";

/**
 * Server-side cache of the Graph token check, so a My reels render or a reel picker click
 * does not make a live Graph call every time. Dropped when a token secret is saved or
 * cleared, and when a measurement hits an auth failure; a measurement run also writes its
 * own outcome here (ok, or a permission refusal). "Check connection" stays live, but /me
 * cannot see the insights permission, so a refusal a measurement saw stands over an ok
 * check until a measurement succeeds or the token secret changes.
 * Kept on globalThis: tsx server.ts (the scheduler) and Next's bundle (actions, renders)
 * each load their own copy of this module in the same process, and must share one cache.
 * ponytail: one process; fine for a single-user local app.
 */
const TTL_MS = 5 * 60_000;
/** rate_limited, network and unknown can clear on their own, so they are rechecked soon. */
const TRANSIENT_TTL_MS = 30_000;
const DEFINITIVE: ReadonlySet<GraphTokenStatus["state"]> = new Set(["ok", "not_configured", "auth_failed", "permission_denied"]);
interface TokenStatusState {
  cached: { status: GraphTokenStatus; at: number } | null;
  denied: GraphTokenStatus | null;
}
const shared = globalThis as { __crowsnestTokenStatus?: TokenStatusState };
const state = (shared.__crowsnestTokenStatus ??= { cached: null, denied: null });

/** `live` skips the cache (Check connection); the answer still refreshes it. */
export async function cachedTokenStatus(now: number = Date.now(), opts: { live?: boolean } = {}): Promise<GraphTokenStatus> {
  const cached = state.cached;
  if (!opts.live && cached && now - cached.at < (DEFINITIVE.has(cached.status.state) ? TTL_MS : TRANSIENT_TTL_MS)) return cached.status;
  let status = await graphClient.checkToken();
  if (status.state === "ok" && state.denied) status = { ...state.denied, checkedAt: status.checkedAt };
  state.cached = { status, at: now };
  return status;
}

export function rememberTokenStatus(status: GraphTokenStatus, now: number = Date.now()): void {
  state.cached = { status, at: now };
  state.denied = status.state === "permission_denied" ? status : null;
}

/** A token secret saved or cleared, or a dead token: forget everything. */
export function invalidateTokenStatus(): void {
  state.cached = null;
  state.denied = null;
}
