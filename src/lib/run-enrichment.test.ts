import { describe, expect, test } from "vitest";
import { enrichedFromEvents, type EnrichmentEventLike } from "./run-enrichment";

function ev(event: string, fields: Record<string, unknown> = {}): EnrichmentEventLike {
  return { event, fields };
}

function finished(enriched: unknown): EnrichmentEventLike {
  return ev("sync.enrich.finished", { channelId: "c1", candidates: 12, enriched, skipped: 0, withheld: 0, stopped: false });
}

describe("enrichedFromEvents", () => {
  test("sums one event per channel", () => {
    expect(enrichedFromEvents([finished(12), finished(5), finished(1)])).toBe(18);
  });

  test("null when the pass never ran, so the UI can stay silent instead of printing 0", () => {
    // The distinction the whole app keeps: a measurement never taken is not a measured
    // zero. A run with a trace full of other events still reports null here.
    expect(enrichedFromEvents([])).toBeNull();
    expect(enrichedFromEvents([ev("sync.started"), ev("sync.channel.finished"), ev("sync.finished")])).toBeNull();
  });

  test("0 when the pass ran and Instagram withheld every count", () => {
    expect(enrichedFromEvents([finished(0)])).toBe(0);
  });

  test("ignores every other event, including the pass's own failure events", () => {
    const events = [ev("sync.enrich.cancelled", { enriched: 99 }), ev("sync.enrich.stopped", { enriched: 99 }), finished(3)];
    expect(enrichedFromEvents(events)).toBe(3);
  });

  test("a malformed enriched field is skipped without erasing the events around it", () => {
    // A row could be hand-edited or predate a field rename. Bailing out of the whole sum
    // would turn one bad row into a run that reports nothing.
    expect(enrichedFromEvents([finished(4), finished("lots"), finished(6)])).toBe(10);
    expect(enrichedFromEvents([finished(undefined), finished(null), finished(Number.NaN)])).toBeNull();
  });
});
