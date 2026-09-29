import { graphClient, type GraphTokenStatus } from "./client";

/**
 * Server-side cache of the Graph token check, so a My reels render or a reel picker click
 * does not make a live Graph call every time. Dropped when a token secret is saved or
 * cleared, and when a measurement hits an auth failure. "Check connection" stays live.
 * ponytail: module-level, one process; fine for a single-user local app.
 */
const TTL_MS = 5 * 60_000;
let cached: { status: GraphTokenStatus; at: number } | null = null;

export async function cachedTokenStatus(now: number = Date.now()): Promise<GraphTokenStatus> {
  if (cached && now - cached.at < TTL_MS) return cached.status;
  const status = await graphClient.checkToken();
  cached = { status, at: now };
  return status;
}

export function invalidateTokenStatus(): void {
  cached = null;
}
