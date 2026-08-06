/**
 * How many view counts a run recovered, derived from its log trace.
 *
 * Lives in `lib/` rather than in `server/queries/runs.ts` because both sides need the
 * identical rule: the server computes it once for the page load, and the run detail
 * screen recomputes it as SSE events arrive so a live run's number moves. Two copies of
 * "sum the enriched field" is how the two would quietly disagree.
 *
 * Null means the pass never ran: the `viewCountEnrichPerChannel` setting is 0, or the run
 * was cancelled or failed before reaching it. That is not the same fact as 0, which means
 * it asked and Instagram withheld every count, and this app does not print a fabricated
 * zero for a measurement it never took.
 */

/** The subset of a log event this needs. Structural, so both a stored `LogEventRow` and a
 *  streamed one satisfy it without either side importing the other's module. */
export interface EnrichmentEventLike {
  event: string;
  fields: Record<string, unknown>;
}

export const ENRICH_FINISHED_EVENT = "sync.enrich.finished";

export function enrichedFromEvents(events: readonly EnrichmentEventLike[]): number | null {
  let total: number | null = null;
  for (const e of events) {
    if (e.event !== ENRICH_FINISHED_EVENT) continue;
    const n = e.fields.enriched;
    // A malformed row contributes nothing but must not erase the events around it, so
    // this skips the value rather than bailing out of the whole sum.
    if (typeof n !== "number" || !Number.isFinite(n)) continue;
    total = (total ?? 0) + n;
  }
  return total;
}
