import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SyncGap, SyncProgress } from "@/server/services/sync-types";
import { SyncProgressPanel } from "./sync-progress-panel";

/**
 * This repo has no DOM test environment — vitest runs in node, and neither jsdom nor
 * testing-library is installed. Rather than bolt one on for a single component, the
 * panel is exercised through `react-dom/server`, which is already a dependency and needs
 * no configuration. That covers exactly what matters here: which of the eight states is
 * on screen, the numbers and words in it, and the aria wiring. It cannot cover clicks —
 * the handlers are one-liners that forward to props, and the props' own logic is covered
 * in `sync-progress-view.test.ts` and by the hook's callers.
 */

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

/** Visible text only, so assertions read like the panel does and never accidentally
 *  match a Tailwind class name inside an attribute. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const START = "2026-07-28T10:00:00.000Z";

function fakeProgress(overrides: Partial<SyncProgress> = {}): SyncProgress {
  return {
    jobId: "job-1",
    status: "running",
    phase: "fetching",
    currentChannelHandle: "@hormozi",
    channelsTotal: 4,
    channelsDone: 1,
    startedAt: START,
    finishedAt: null,
    heartbeatAt: START,
    itemsSeen: 120,
    itemsCreated: 40,
    itemsUpdated: 8,
    itemsFailed: 0,
    itemsDeleted: 0,
    assetsDownloaded: 38,
    assetsFailed: 2,
    retries: 0,
    stopReason: null,
    errorCode: null,
    errorMessage: null,
    gaps: [],
    cancelRequested: false,
    lookbackDays: 90,
    maxItems: 500,
    ...overrides,
  };
}

function fakeGap(overrides: Partial<SyncGap> = {}): SyncGap {
  return { channelId: "chan-1", handle: "@hormozi", provider: "instagram", error: "boom", code: null, ...overrides };
}

const noop = () => {};

function panel(props: Partial<React.ComponentProps<typeof SyncProgressPanel>> = {}): string {
  return render(<SyncProgressPanel progress={fakeProgress()} stalled={false} onCancel={noop} onRetry={noop} {...props} />);
}

describe("idle — no sync_jobs row at all", () => {
  const html = panel({ progress: null });

  test("says so plainly instead of showing a bar at zero", () => {
    expect(text(html)).toContain("No sync has run yet");
    expect(text(html)).toContain("Nothing in sync_jobs to report.");
  });

  test("draws no progressbar and no counters", () => {
    expect(html).not.toContain('role="progressbar"');
    expect(text(html)).not.toContain("assets saved");
  });

  test("offers no cancel for a run that isn't happening", () => {
    expect(text(html)).not.toContain("Cancel");
  });
});

describe("running — determinate on channels", () => {
  const html = panel();

  test("the bar's aria values are the real channel counts", () => {
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="4"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('aria-valuetext="1 of 4 channels"');
  });

  test("the drawn width is the same fraction, not an approximation of it", () => {
    expect(html).toContain("width:25%");
    expect(text(html)).toContain("1 / 4 · 25%");
  });

  test("the headline is the phase plus the channel being worked", () => {
    expect(text(html)).toContain("Fetching posts — @hormozi");
  });

  test("items are a count against the cap and are given no percentage", () => {
    expect(text(html)).toContain("120 / 500 (cap)");
    expect(text(html)).toMatch(/only denominator/);
    // 24% would be itemsSeen/maxItems dressed up as progress. It must not appear.
    expect(text(html)).not.toContain("24%");
  });

  test("every counter is on screen", () => {
    const visible = text(html);
    for (const label of ["created", "updated", "failed", "deleted", "assets saved", "assets failed"]) {
      expect(visible).toContain(label);
    }
  });

  test("elapsed time comes from startedAt", () => {
    const html65 = panel({ progress: fakeProgress({ startedAt: new Date(Date.now() - 65_000).toISOString() }) });
    expect(text(html65)).toContain("running for 1:05");
  });

  test("cancel is offered and enabled", () => {
    expect(text(html)).toContain("Cancel");
    // `disabled:` also appears inside the button's Tailwind classes, so match the attribute.
    expect(html).not.toMatch(/\sdisabled=""/);
  });

  test("status changes are announced", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  test("zero retries says nothing at all", () => {
    expect(text(html)).not.toContain("retried");
  });

  test("non-zero retries read as recovery, not as an error", () => {
    expect(text(panel({ progress: fakeProgress({ retries: 3 }) }))).toContain("retried 3 times");
  });
});

describe("running — channel list not yet resolved", () => {
  const html = panel({ progress: fakeProgress({ channelsTotal: null, channelsDone: 0, phase: "starting" }) });

  test("the bar is indeterminate rather than sitting at a made-up zero", () => {
    expect(html).toContain("data-indeterminate");
    expect(html).not.toContain("aria-valuenow");
  });

  test("and it says why", () => {
    expect(text(html)).toContain("resolving channels");
    expect(text(html)).toContain("hasn't enumerated its channel list yet");
    expect(html).toContain('aria-valuetext="resolving the channel list"');
  });

  test("nothing is drawn: the indicator gets no width, so there is no bar pretending to fill", () => {
    expect(html).not.toMatch(/width:\d+%/);
  });
});

describe("cancelling", () => {
  const html = panel({ progress: fakeProgress({ cancelRequested: true }) });

  test("the button reports the request, and can't be pressed twice", () => {
    expect(text(html)).toContain("Cancelling…");
    expect(html).toMatch(/\sdisabled=""/);
  });

  test("the headline explains that cancellation is co-operative", () => {
    expect(text(html)).toContain("Cancelling — waiting for the request already in flight");
  });

  test("it does not promise the channel in progress will finish", () => {
    // The engine abandons the remaining retry budget on cancel, so saying the channel is
    // being "finished" would be a promise the engine does not keep.
    const visible = text(html);
    expect(visible).not.toContain("finishing the current channel");
    expect(visible).toContain("won't complete");
    expect(visible).toContain("Everything already saved is kept");
  });

  test("nor does it say where that channel will turn up — the run hasn't finalized", () => {
    // Mid-retry it becomes a gap; on a healthy in-flight request it becomes no gap at
    // all. Neither is known while the row is still `running`.
    expect(text(html)).not.toContain("listed below");
  });
});

describe("stalled", () => {
  const html = panel({ stalled: true });

  test("says the run stopped reporting rather than pretending it is working", () => {
    expect(text(html)).toContain("This sync stopped reporting");
    expect(text(html)).toContain("died holding the sync lock");
  });

  test("offers the recovery", () => {
    expect(text(html)).toContain("Start a new sync");
  });

  test("does not offer a cancel that a dead process can never honour", () => {
    expect(text(html)).not.toContain("Cancel");
  });

  test("outranks a cancel request that will never be serviced", () => {
    const both = panel({ progress: fakeProgress({ cancelRequested: true }), stalled: true });
    expect(text(both)).toContain("This sync stopped reporting");
    expect(text(both)).not.toContain("Cancelling…");
  });
});

describe("terminal — success", () => {
  const html = panel({
    progress: fakeProgress({ status: "success", finishedAt: "2026-07-28T10:02:00.000Z", channelsDone: 4, stopReason: "lookback" }),
  });

  test("names the counts behind the verdict", () => {
    expect(text(html)).toContain("Sync finished — 40 new, 8 updated");
  });

  test("says why it stopped, and reports a settled duration", () => {
    expect(text(html)).toContain("The run reached the lookback boundary.");
    expect(text(html)).toContain("took 2:00");
  });

  test("no cancel on a finished run", () => {
    expect(text(html)).not.toContain("Cancel");
  });
});

describe("terminal — partial, with per-channel failures", () => {
  const gaps = [
    fakeGap({ channelId: "chan-1", handle: "@hormozi", code: "IG_AUTH_REQUIRED", error: "401" }),
    fakeGap({ channelId: "chan-2", handle: "@garyvee", code: "IG_PRIVATE", error: "private" }),
  ];
  const html = panel({ progress: fakeProgress({ status: "partial", finishedAt: START, channelsDone: 2, gaps }) });

  test("counts the unfinished channels in the headline", () => {
    expect(text(html)).toContain("Sync finished with 2 channels unfinished");
    expect(text(html)).toContain("2 channels didn't finish");
  });

  test("each gap is named by handle, not by id", () => {
    expect(text(html)).toContain("@hormozi");
    expect(text(html)).toContain("@garyvee");
    expect(text(html)).not.toContain("chan-1");
  });

  test("each code becomes an actionable sentence — never a bare code", () => {
    expect(text(html)).toContain("The Instagram session has expired. Re-import it in Settings");
    expect(text(html)).toContain("This account is private");
  });

  test("a hopeless retry is labelled as such", () => {
    expect(html).toContain('aria-label="Retry @hormozi"');
    expect(html).toContain('aria-label="Retry anyway @garyvee"');
  });

  test("a gap with no handle is still named, and its retry button still labelled", () => {
    // 10 of the 12 gap rows in the live database pre-date the handle column and carry "".
    // That rendered a nameless row and a button whose entire accessible name was "Retry ".
    const legacy = panel({
      progress: fakeProgress({ status: "partial", finishedAt: START, gaps: [fakeGap({ handle: "", channelId: "chan-7" })] }),
    });
    expect(text(legacy)).toContain("channel chan-7");
    expect(legacy).toContain('aria-label="Retry channel chan-7"');
    expect(legacy).not.toContain('aria-label="Retry "');
  });

  test("a single retry-them-all button is offered too", () => {
    expect(text(html)).toContain("Retry 2 failed");
  });

  test("singular when only one channel failed", () => {
    const one = panel({ progress: fakeProgress({ status: "partial", finishedAt: START, gaps: [gaps[0]] }) });
    expect(text(one)).toContain("Sync finished with 1 channel unfinished");
    expect(text(one)).toContain("Retry 1 failed");
  });
});

describe("terminal — failed", () => {
  const html = panel({
    progress: fakeProgress({
      status: "failed",
      finishedAt: START,
      stopReason: "error",
      errorCode: "IG_SERVICE_DOWN",
      errorMessage: "connection refused to http://127.0.0.1:8765",
    }),
  });

  test("the message is what the user reads; the code is only supporting evidence", () => {
    const visible = text(html);
    expect(visible).toContain("Sync failed");
    expect(visible).toContain("connection refused to http://127.0.0.1:8765");
    expect(visible.indexOf("connection refused")).toBeLessThan(visible.indexOf("IG_SERVICE_DOWN"));
  });
});

describe("terminal — failed with every channel gapped", () => {
  // Engine audit F11: a run where nothing succeeded now records `failed` rather than
  // `partial`. The panel must not report total failure as partial success.
  const gaps = [
    fakeGap({ channelId: "chan-1", handle: "@hormozi", code: "IG_AUTH_REQUIRED", error: "session expired" }),
    fakeGap({ channelId: "chan-2", handle: "@garyvee", code: "IG_AUTH_REQUIRED", error: "session expired" }),
  ];
  const html = panel({
    progress: fakeProgress({
      status: "failed",
      finishedAt: START,
      channelsDone: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      stopReason: "error",
      errorCode: "IG_AUTH_REQUIRED",
      errorMessage: "session expired",
      gaps,
    }),
  });

  test("reads as failed, never as a partial success", () => {
    expect(text(html)).toContain("Sync failed");
    expect(text(html)).not.toContain("Sync finished");
  });

  test("still lists every channel with its own actionable message and retry", () => {
    expect(text(html)).toContain("2 channels didn't finish");
    expect(text(html)).toContain("The Instagram session has expired. Re-import it in Settings");
    expect(html).toContain('aria-label="Retry @hormozi"');
    expect(text(html)).toContain("Retry 2 failed");
  });

  test("the bar honestly shows nothing got done", () => {
    expect(html).toContain('aria-valuenow="0"');
    expect(text(html)).toContain("0 / 4 · 0%");
  });
});

describe("terminal — cancelled", () => {
  const html = panel({ progress: fakeProgress({ status: "partial", finishedAt: START, stopReason: "cancelled" }) });

  test("is not reported as a failure", () => {
    expect(text(html)).toContain("Sync cancelled");
    expect(text(html)).not.toContain("Sync failed");
  });

  test("promises that saved work survives", () => {
    expect(text(html)).toContain("Everything saved before the cancel is kept");
  });

  test("stopped mid-healthy-request: no gap list, and the reader isn't sent hunting for one", () => {
    // The engine records no gap here and leaves the channel's sync_error untouched. The
    // only trace is the bar showing 1 of 4 done.
    const visible = text(html);
    expect(visible).toContain("left untouched");
    expect(visible).not.toContain("didn't finish");
    expect(visible).not.toContain("Retry 1 failed");
    expect(html).toContain('aria-valuenow="1"');
  });

  test("interrupted mid-retry: the gap is explained rather than left looking unrelated", () => {
    const midRetry = panel({
      progress: fakeProgress({
        status: "partial",
        finishedAt: START,
        stopReason: "cancelled",
        gaps: [fakeGap({ handle: "@hormozi", code: "IG_RATE_LIMITED", error: "429" })],
      }),
    });
    const visible = text(midRetry);
    expect(visible).toContain("Sync cancelled");
    expect(visible).toContain("interrupted mid-retry");
    // The gap still carries its real upstream reason, which is the whole confusion the
    // sentence above exists to defuse.
    expect(visible).toContain("Instagram is throttling us");
  });
});

describe("a broken poll", () => {
  const html = panel({ pollError: "fetch failed" });

  test("does not blank the numbers already on screen", () => {
    expect(text(html)).toContain("Fetching posts — @hormozi");
    expect(text(html)).toContain("120 / 500 (cap)");
  });

  test("and admits that they are stale", () => {
    expect(text(html)).toContain("Progress updates are failing: fetch failed");
    expect(text(html)).toContain("the last ones that arrived");
  });

  test("with nothing rendered yet it reports the error on its own", () => {
    const empty = panel({ progress: null, pollError: "offline" });
    expect(text(empty)).toContain("Progress updates are failing: offline");
    expect(text(empty)).not.toContain("the last ones that arrived");
  });
});
