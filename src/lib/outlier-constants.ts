/**
 * Client-safe home for outlier-score cutoffs that both a server query and a client
 * component need to agree on. Split out of `server/queries/channels.ts` (M4, branch
 * review) — that module imports `@/server/db`, so a client component importing anything
 * from it would drag server code into the client bundle for the sake of one number.
 * This file imports nothing, so both sides can import the same constant instead of
 * keeping two copies of the literal in sync by hand.
 */

// The Channels table's "Outliers (30d)" column cutoff — a different (lower) bar than the
// Feed's default "Balanced" view (5x), by design: docs/qa/2026-08-01-feed-fix-plan.md
// "Finding 4" covers why both numbers need to stay visible rather than unified, so the
// word "outlier" doesn't silently mean two different things across the app.
export const OUTLIERS_30D_MIN_SCORE = 2;
