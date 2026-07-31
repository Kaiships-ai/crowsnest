import { describe, expect, test } from "vitest";

import type { FailureStrip, FailureStripKind } from "@/server/queries/failure-surface";
import {
  cooldownRemainingSec,
  failureStripAction,
  failureStripCopy,
  failureStripFacts,
  failureStripHeadline,
  failureStripTitle,
  failureStripTone,
  formatCooldownWait,
  formatKeptCounts,
} from "./failure-strip-view";

function strip(overrides: Partial<FailureStrip> = {}): FailureStrip {
  return {
    kind: "partial",
    jobId: "job-1",
    isRunning: false,
    finishedAt: "2026-07-31T10:00:00.000Z",
    stopReason: null,
    errorCode: null,
    errorMessage: null,
    cooldownRetryAfterSec: null,
    kept: { itemsCreated: 4, itemsUpdated: 2, channelsSynced: 3, channelsTotal: 5 },
    gaps: [],
    ...overrides,
  };
}

const ALL_KINDS: FailureStripKind[] = ["none", "running", "service_down", "session_expired", "cooldown", "offline", "partial", "failed"];

describe("failureStripTone", () => {
  test("none and running render nothing", () => {
    expect(failureStripTone("none")).toBeNull();
    expect(failureStripTone("running")).toBeNull();
  });

  test("partial is the one soft register — the connection is fine", () => {
    expect(failureStripTone("partial")).toBe("warn");
  });

  test("every connection-level kind, plus a total failure, reads as the harder tone", () => {
    for (const kind of ["service_down", "session_expired", "cooldown", "offline", "failed"] as const) {
      expect(failureStripTone(kind)).toBe("bad");
    }
  });

  test("every kind is covered — exhaustiveness guard", () => {
    for (const kind of ALL_KINDS) expect(() => failureStripTone(kind)).not.toThrow();
  });
});

describe("failureStripTitle", () => {
  test("none and running have no title, since nothing renders for them", () => {
    expect(failureStripTitle("none")).toBe("");
    expect(failureStripTitle("running")).toBe("");
  });

  test("every visible kind gets a distinct, non-empty title", () => {
    const visible: FailureStripKind[] = ["service_down", "session_expired", "cooldown", "offline", "partial", "failed"];
    const titles = visible.map((k) => failureStripTitle(k));
    expect(titles.every((t) => t.length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("formatKeptCounts", () => {
  test("null kept says nothing was recorded, not zero of everything", () => {
    expect(formatKeptCounts(null)).toBe("Nothing was recorded as kept before the run stopped");
  });

  test("full kept prints both channel coverage and item counts", () => {
    expect(formatKeptCounts({ itemsCreated: 40, itemsUpdated: 6, channelsSynced: 3, channelsTotal: 5 })).toBe(
      "3 of 5 channels synced · 40 new, 6 updated",
    );
  });

  test("channelsSynced null but channelsTotal known still names the attempt, not a fraction", () => {
    expect(formatKeptCounts({ itemsCreated: 0, itemsUpdated: 0, channelsSynced: null, channelsTotal: 4 })).toBe(
      "4 channels attempted · 0 new, 0 updated",
    );
  });

  test("both channel fields null falls back to items only", () => {
    expect(formatKeptCounts({ itemsCreated: 2, itemsUpdated: 0, channelsSynced: null, channelsTotal: null })).toBe("2 new, 0 updated");
  });
});

describe("failureStripHeadline — connection-level kinds never blame one channel", () => {
  test("cooldown says 'the whole connection', not the channel that surfaced it", () => {
    const headline = failureStripHeadline(strip({ kind: "cooldown", errorCode: "IG_RATE_LIMITED" }));
    expect(headline).toContain("whole connection");
    expect(headline).not.toMatch(/this channel/i);
  });

  test("service_down names the sidecar, not a channel", () => {
    const headline = failureStripHeadline(strip({ kind: "service_down", errorCode: "IG_SERVICE_DOWN" }));
    expect(headline.toLowerCase()).toContain("sidecar");
  });

  test("session_expired points at Settings", () => {
    const headline = failureStripHeadline(strip({ kind: "session_expired", errorCode: "IG_AUTH_REQUIRED" }));
    expect(headline).toContain("Settings");
  });

  test("offline says nothing already synced was lost", () => {
    const headline = failureStripHeadline(strip({ kind: "offline", errorCode: "IG_NETWORK" }));
    expect(headline.toLowerCase()).toContain("stays put");
  });

  test("failed says the connection itself is fine", () => {
    const headline = failureStripHeadline(strip({ kind: "failed", errorCode: "IG_NOT_FOUND" }));
    expect(headline.toLowerCase()).toContain("connection itself is fine");
  });
});

describe("failureStripHeadline — partial names what survived", () => {
  test("names the gap count and what came back, not just 'sync failed'", () => {
    const s = strip({
      kind: "partial",
      gaps: [{ channelId: "c1", handle: "@a", error: "private", code: "IG_PRIVATE" }],
      kept: { itemsCreated: 40, itemsUpdated: 6, channelsSynced: 2, channelsTotal: 3 },
    });
    const headline = failureStripHeadline(s);
    expect(headline).toContain("1 channel didn't finish");
    expect(headline).toContain("2 of 3 channels synced");
    expect(headline).toContain("40 new, 6 updated");
  });

  test("pluralises correctly for more than one gap", () => {
    const s = strip({
      kind: "partial",
      gaps: [
        { channelId: "c1", handle: "@a", error: "x", code: "IG_PRIVATE" },
        { channelId: "c2", handle: "@b", error: "y", code: "IG_NOT_FOUND" },
      ],
    });
    expect(failureStripHeadline(s)).toContain("2 channels didn't finish");
  });
});

describe("cooldownRemainingSec — real facts, never a guess", () => {
  test("null when Instagram gave no countdown at all", () => {
    expect(cooldownRemainingSec({ finishedAt: "2026-07-31T10:00:00.000Z", cooldownRetryAfterSec: null })).toBeNull();
  });

  test("null when there's no finishedAt to count from", () => {
    expect(cooldownRemainingSec({ finishedAt: null, cooldownRetryAfterSec: 60 })).toBeNull();
  });

  test("counts down from the real deadline", () => {
    const now = new Date("2026-07-31T10:00:30.000Z").getTime();
    const remaining = cooldownRemainingSec({ finishedAt: "2026-07-31T10:00:00.000Z", cooldownRetryAfterSec: 90 }, now);
    expect(remaining).toBe(60);
  });

  test("clamps at 0 rather than going negative once the wait has passed", () => {
    const now = new Date("2026-07-31T10:05:00.000Z").getTime();
    const remaining = cooldownRemainingSec({ finishedAt: "2026-07-31T10:00:00.000Z", cooldownRetryAfterSec: 90 }, now);
    expect(remaining).toBe(0);
  });
});

describe("formatCooldownWait", () => {
  test("null says there's no countdown to show, not '0:00'", () => {
    expect(formatCooldownWait(null)).not.toMatch(/0:00/);
    expect(formatCooldownWait(null).toLowerCase()).toContain("no countdown");
  });

  test("0 says the wait has passed", () => {
    expect(formatCooldownWait(0).toLowerCase()).toContain("passed");
  });

  test("formats mm:ss for a real remaining count", () => {
    expect(formatCooldownWait(65)).toContain("1:05");
  });
});

describe("failureStripAction", () => {
  test("service_down offers the start command, not a sync retry", () => {
    expect(failureStripAction(strip({ kind: "service_down" }), null)).toEqual({
      kind: "copy_command",
      label: "Copy start command",
      disabled: false,
    });
  });

  test("session_expired routes to Settings", () => {
    expect(failureStripAction(strip({ kind: "session_expired" }), null).kind).toBe("settings");
  });

  test("cooldown disables the action while a real countdown is still running", () => {
    const action = failureStripAction(strip({ kind: "cooldown" }), 42);
    expect(action.disabled).toBe(true);
  });

  test("cooldown re-enables once the countdown hits zero", () => {
    const action = failureStripAction(strip({ kind: "cooldown" }), 0);
    expect(action.disabled).toBe(false);
    expect(action.label).toBe("Try again");
  });

  test("cooldown with no countdown at all is not disabled by a guess", () => {
    const action = failureStripAction(strip({ kind: "cooldown" }), null);
    expect(action.disabled).toBe(false);
  });

  test("partial with gaps retries exactly those channels", () => {
    const s = strip({ kind: "partial", gaps: [{ channelId: "c1", handle: "@a", error: "x", code: null }] });
    expect(failureStripAction(s, null)).toEqual({ kind: "retry_gaps", label: "Retry 1 channel", disabled: false });
  });

  test("partial with no gaps offers a plain resync", () => {
    expect(failureStripAction(strip({ kind: "partial", gaps: [] }), null).kind).toBe("retry_all");
  });

  test("failed with gaps retries them; failed with none retries the whole run", () => {
    expect(failureStripAction(strip({ kind: "failed", gaps: [] }), null)).toEqual({ kind: "retry_all", label: "Retry", disabled: false });
    const s = strip({ kind: "failed", gaps: [{ channelId: "c1", handle: "@a", error: "x", code: "IG_NOT_FOUND" }] });
    expect(failureStripAction(s, null).kind).toBe("retry_gaps");
  });
});

describe("failureStripFacts", () => {
  test("drops fields that came back null instead of rendering them empty", () => {
    const facts = failureStripFacts(strip({ kind: "failed", errorCode: null, errorMessage: null, kept: null }));
    expect(facts).toBe("Nothing was recorded as kept before the run stopped");
  });

  test("joins every present fact with the mono separator", () => {
    const facts = failureStripFacts(
      strip({ kind: "cooldown", errorCode: "IG_RATE_LIMITED", errorMessage: "please wait", kept: { itemsCreated: 1, itemsUpdated: 0, channelsSynced: 1, channelsTotal: 2 } }),
    );
    expect(facts).toBe("IG_RATE_LIMITED · please wait · 1 of 2 channels synced · 1 new, 0 updated");
  });

  // Seen on the running app once a real cancelled run existed: the strip printed
  // "1 of 1 channels synced · 0 new, 0 updated" inside its sentence and again on the
  // line below it. Partial is the only kind whose headline already carries the counts.
  test("partial does not repeat the kept counts its own sentence already states", () => {
    const s = strip({ kind: "partial", errorCode: null, errorMessage: null, kept: { itemsCreated: 0, itemsUpdated: 0, channelsSynced: 1, channelsTotal: 1 } });
    expect(failureStripHeadline(s)).toContain("1 of 1 channels synced");
    expect(failureStripFacts(s)).toBe("");
  });
});

describe("failureStripCopy", () => {
  test("null for none and running — the caller's one signal to render nothing", () => {
    expect(failureStripCopy(strip({ kind: "none" }))).toBeNull();
    expect(failureStripCopy(strip({ kind: "running" }))).toBeNull();
  });

  test("every other kind produces a full copy object", () => {
    for (const kind of ["service_down", "session_expired", "cooldown", "offline", "partial", "failed"] as const) {
      const copy = failureStripCopy(strip({ kind }));
      expect(copy).not.toBeNull();
      expect(copy?.title.length).toBeGreaterThan(0);
      expect(copy?.headline.length).toBeGreaterThan(0);
    }
  });
});
