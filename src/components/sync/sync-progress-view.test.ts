import { describe, expect, test } from "vitest";

import { SYNC_STALL_SECONDS, type SyncGap, type SyncProgress } from "@/server/services/sync-types";
import {
  ACTIVE_POLL_MS,
  IDLE_POLL_MS,
  channelPercent,
  elapsedMs,
  formatElapsed,
  formatItemsAgainstCap,
  gapDisplayName,
  gapMessage,
  gapRetryLabel,
  isSyncStalled,
  phaseLabel,
  pollIntervalMs,
  reducePoll,
  retriesLabel,
  stateTone,
  statusDetail,
  statusHeadline,
  stopReasonLabel,
  syncViewState,
  type PollState,
} from "./sync-progress-view";

/**
 * This repo runs vitest in node with no jsdom and no testing-library, so nothing here
 * can mount a component and let its effects run. The panel gets around that by rendering
 * through `react-dom/server` (see sync-progress-panel.test.tsx); `useSyncProgress`
 * cannot — effects never fire in a server render.
 *
 * So every decision either of them makes lives here as a plain function instead of
 * inside JSX or inside the hook body: which of the eight states is on screen, what words
 * go with a failure code, what fraction the bar draws, how often to poll, and what a
 * poll result does to what is already rendered. Those are covered directly below. What
 * remains untested is the wiring around them — the interval, the visibility listener and
 * the request-sequencing guard in `use-sync-progress.ts`.
 */

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

describe("phaseLabel", () => {
  test("every phase in the contract has human words", () => {
    expect(phaseLabel("starting")).toBe("Starting up");
    expect(phaseLabel("profile")).toBe("Reading the profile");
    expect(phaseLabel("fetching")).toBe("Fetching posts");
    expect(phaseLabel("saving")).toBe("Saving posts and thumbnails");
    expect(phaseLabel("scoring")).toBe("Scoring outliers");
    expect(phaseLabel("finalizing")).toBe("Finishing up");
  });

  test("retrying reads as recovery, not as a hang", () => {
    expect(phaseLabel("retrying")).toBe("Backing off after an upstream error");
  });

  test("a null phase does not get invented into a specific one", () => {
    expect(phaseLabel(null)).toBe("Working");
  });
});

describe("gapMessage", () => {
  test("IG_AUTH_REQUIRED points at re-importing the session in Settings", () => {
    const message = gapMessage(fakeGap({ code: "IG_AUTH_REQUIRED" }));
    expect(message).toMatch(/session has expired/i);
    expect(message).toMatch(/Settings/);
  });

  test("IG_SERVICE_DOWN blames the local sidecar and names the command", () => {
    expect(gapMessage(fakeGap({ code: "IG_SERVICE_DOWN" }))).toMatch(/npm run ig:service/);
  });

  test("IG_RATE_LIMITED says to wait, and says nothing is broken", () => {
    const message = gapMessage(fakeGap({ code: "IG_RATE_LIMITED" }));
    expect(message).toMatch(/throttling/i);
    expect(message).toMatch(/nothing is broken/i);
  });

  test("IG_PRIVATE and IG_NOT_FOUND are about the account, not about us", () => {
    expect(gapMessage(fakeGap({ code: "IG_PRIVATE" }))).toMatch(/about the account, not about this app/);
    expect(gapMessage(fakeGap({ code: "IG_NOT_FOUND" }))).toMatch(/about the account, not about this app/);
  });

  test("IG_SERVICE_UNAUTHORIZED is not confused with an expired IG session", () => {
    const message = gapMessage(fakeGap({ code: "IG_SERVICE_UNAUTHORIZED" }));
    expect(message).toMatch(/IG_SERVICE_TOKEN/);
    expect(message).not.toMatch(/expired/i);
  });

  test("a raw code is never the whole message — unmapped codes fall back to the engine's prose", () => {
    expect(gapMessage(fakeGap({ code: "IG_SOMETHING_NEW", error: "the mapper exploded" }))).toBe("the mapper exploded");
  });

  test("no code and no message still produces a sentence rather than a blank", () => {
    expect(gapMessage(fakeGap({ code: null, error: "  " }))).toBe("This channel failed and the sync engine recorded no reason.");
  });
});

describe("gapDisplayName", () => {
  test("uses the handle when the row has one", () => {
    expect(gapDisplayName(fakeGap({ handle: "@hormozi" }))).toBe("@hormozi");
  });

  test("falls back to the channel id — 10 of 12 live gap rows pre-date the handle column", () => {
    expect(gapDisplayName(fakeGap({ handle: "", channelId: "chan-1" }))).toBe("channel chan-1");
    expect(gapDisplayName(fakeGap({ handle: "   ", channelId: "chan-1" }))).toBe("channel chan-1");
  });

  test("never returns an empty string, so no row is nameless and no button unlabelled", () => {
    expect(gapDisplayName(fakeGap({ handle: "", channelId: "" }))).toBe("an unnamed channel");
    for (const gap of [fakeGap({ handle: "" }), fakeGap({ handle: "", channelId: "" }), fakeGap()]) {
      expect(gapDisplayName(gap).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("gapRetryLabel", () => {
  test("retryable failures offer a plain Retry", () => {
    expect(gapRetryLabel("IG_RATE_LIMITED")).toBe("Retry");
    expect(gapRetryLabel("IG_SERVICE_DOWN")).toBe("Retry");
    expect(gapRetryLabel(null)).toBe("Retry");
  });

  test("failures a retry cannot change are not presented as the fix", () => {
    expect(gapRetryLabel("IG_PRIVATE")).toBe("Retry anyway");
    expect(gapRetryLabel("IG_NOT_FOUND")).toBe("Retry anyway");
    expect(gapRetryLabel("IG_DRIFT")).toBe("Retry anyway");
  });
});

describe("channelPercent", () => {
  test("the only honest fraction a sync has", () => {
    expect(channelPercent(1, 4)).toBe(25);
    expect(channelPercent(0, 3)).toBe(0);
    expect(channelPercent(3, 3)).toBe(100);
  });

  test("null total means indeterminate, not zero percent", () => {
    expect(channelPercent(0, null)).toBeNull();
  });

  test("a zero total is indeterminate too rather than a divide by zero", () => {
    expect(channelPercent(0, 0)).toBeNull();
  });

  test("done above total (a channel added mid-run) clamps instead of overflowing the bar", () => {
    expect(channelPercent(5, 4)).toBe(100);
  });
});

describe("elapsedMs / formatElapsed", () => {
  test("a live run measures to now", () => {
    const now = new Date(START).getTime() + 65_000;
    expect(elapsedMs(fakeProgress(), now)).toBe(65_000);
  });

  test("a finished run measures to finishedAt and stops moving", () => {
    const progress = fakeProgress({ finishedAt: "2026-07-28T10:02:00.000Z" });
    const wayLater = new Date(START).getTime() + 9_000_000;
    expect(elapsedMs(progress, wayLater)).toBe(120_000);
  });

  test("clock skew never renders a negative duration", () => {
    expect(elapsedMs(fakeProgress(), new Date(START).getTime() - 5_000)).toBe(0);
  });

  test("M:SS below an hour, H:MM:SS above", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
  });
});

describe("formatItemsAgainstCap", () => {
  test("items are a count against the cap, never a percentage", () => {
    expect(formatItemsAgainstCap(120, 500)).toBe("120 / 500 (cap)");
  });
});

describe("retriesLabel", () => {
  test("zero renders nothing rather than a reassuring 'retried 0 times'", () => {
    expect(retriesLabel(0)).toBeNull();
    expect(retriesLabel(-1)).toBeNull();
  });

  test("non-zero reads as recovery", () => {
    expect(retriesLabel(1)).toBe("retried once");
    expect(retriesLabel(3)).toBe("retried 3 times");
  });
});

describe("syncViewState", () => {
  test("no job row at all is its own state", () => {
    expect(syncViewState(null, false)).toBe("idle");
  });

  test("healthy work", () => {
    expect(syncViewState(fakeProgress(), false)).toBe("running");
  });

  test("cancel requested but still running reads as cancelling", () => {
    expect(syncViewState(fakeProgress({ cancelRequested: true }), false)).toBe("cancelling");
  });

  test("a stalled run outranks cancelling — a dead process will never honour the cancel", () => {
    expect(syncViewState(fakeProgress({ cancelRequested: true }), true)).toBe("stalled");
  });

  test("terminal statuses pass through", () => {
    expect(syncViewState(fakeProgress({ status: "success", finishedAt: START }), false)).toBe("success");
    expect(syncViewState(fakeProgress({ status: "partial", finishedAt: START }), false)).toBe("partial");
    expect(syncViewState(fakeProgress({ status: "failed", finishedAt: START }), false)).toBe("failed");
  });

  test("a cancelled run that did real work is not reported as a failure", () => {
    expect(syncViewState(fakeProgress({ status: "partial", stopReason: "cancelled", finishedAt: START }), false)).toBe("cancelled");
    expect(syncViewState(fakeProgress({ status: "success", stopReason: "cancelled", finishedAt: START }), false)).toBe("cancelled");
  });

  test("but a cancel does not launder a total failure into a cancellation", () => {
    // `status` and `stopReason` are independent: "did the work get done" vs "why did it
    // stop". Two rows in the live database are `failed | cancelled | IG_NETWORK` with
    // zero channels synced, and this used to render them amber "Sync cancelled" while
    // the Settings summary read "failed" off the same row.
    const totalFailure = fakeProgress({ status: "failed", stopReason: "cancelled", finishedAt: START, channelsDone: 0 });
    expect(syncViewState(totalFailure, false)).toBe("failed");
    expect(stateTone(syncViewState(totalFailure, false))).toBe("bad");
  });

  test("that failure still says the user cancelled it — both facts, or neither", () => {
    // The mirror-image bug: routing it to `failed` and stopping there reads as the app
    // breaking on its own, when in fact the user stopped it.
    const totalFailure = fakeProgress({
      status: "failed",
      stopReason: "cancelled",
      finishedAt: START,
      errorCode: "IG_NETWORK",
      errorMessage: "connection reset",
    });
    const state = syncViewState(totalFailure, false);
    expect(statusHeadline(state, totalFailure)).toBe("Sync failed — cancelled before anything synced");
    const detail = statusDetail(state, totalFailure) ?? "";
    expect(detail).toMatch(/recorded as a failure rather than a cancellation/);
    expect(detail).toContain("connection reset");
  });

  test("an ordinary failure is not given a cancel it never had", () => {
    const plain = fakeProgress({ status: "failed", stopReason: "error", finishedAt: START, errorMessage: "boom" });
    expect(statusHeadline("failed", plain)).toBe("Sync failed");
    expect(statusDetail("failed", plain)).toBe("boom");
  });

  test("stalled only applies to a running row", () => {
    expect(syncViewState(fakeProgress({ status: "success", finishedAt: START }), true)).toBe("success");
  });
});

describe("stateTone", () => {
  test("stalled and failed are the only red states", () => {
    expect(stateTone("stalled")).toBe("bad");
    expect(stateTone("failed")).toBe("bad");
    expect(stateTone("partial")).toBe("warn");
    expect(stateTone("cancelled")).toBe("warn");
    expect(stateTone("success")).toBe("ok");
    expect(stateTone("running")).toBe("busy");
    expect(stateTone("cancelling")).toBe("busy");
    expect(stateTone("idle")).toBe("idle");
  });
});

describe("statusHeadline / statusDetail", () => {
  test("running names the phase and the channel being worked", () => {
    expect(statusHeadline("running", fakeProgress())).toBe("Fetching posts — @hormozi");
  });

  test("running with no channel yet omits the handle rather than printing null", () => {
    expect(statusHeadline("running", fakeProgress({ phase: "starting", currentChannelHandle: null }))).toBe("Starting up");
  });

  test("stalled says the run stopped reporting", () => {
    expect(statusHeadline("stalled", fakeProgress())).toBe("This sync stopped reporting");
    const detail = statusDetail("stalled", fakeProgress());
    expect(detail).toMatch(/heartbeat/i);
    expect(detail).toMatch(/sync lock/i);
  });

  test("stalled is worded as suspicion, not as a death certificate", () => {
    // The engine's stale-lock reaper waits an order of magnitude longer than
    // SYNC_STALL_SECONDS, so between the two there is a real window in which a run that
    // looks stalled is still alive. Claiming it died, or promising that a new sync will
    // take the lock back, is false inside that window.
    const detail = statusDetail("stalled", fakeProgress()) ?? "";
    expect(detail).toMatch(/may yet recover/i);
    expect(detail).not.toMatch(/nothing is running/i);
    expect(detail).not.toMatch(/will take the lock back/i);
    expect(detail).toMatch(/can be refused/i);
  });

  test("the stall threshold is quoted from the shared constant, never hard-coded", () => {
    const detail = statusDetail("stalled", fakeProgress()) ?? "";
    expect(detail).toContain(String(SYNC_STALL_SECONDS));
    // The reaper's own timeout belongs to the engine; repeating it here is how this copy
    // drifts out of date.
    expect(detail).not.toMatch(/\b(15|30) minutes?\b/);
  });

  test("success quotes the counts that justify it", () => {
    expect(statusHeadline("success", fakeProgress({ status: "success", itemsCreated: 40, itemsUpdated: 8 }))).toBe(
      "Sync finished — 40 new, 8 updated",
    );
  });

  test("an incremental success reads as up to date, not a bare 0 new", () => {
    const upToDate = fakeProgress({ status: "success", stopReason: "upToDate", itemsCreated: 0, itemsUpdated: 12 });
    expect(statusHeadline("success", upToDate)).toBe("Already up to date — 12 updated");
    // and its detail is grammatical in the "The run ..." template, not "The run already up to date."
    expect(statusDetail("success", upToDate)).toBe("The run stopped early once it reached posts it already had.");
  });

  test("partial says how many channels are unfinished, singular and plural", () => {
    const one = fakeProgress({ status: "partial", gaps: [fakeGap()] });
    expect(statusHeadline("partial", one)).toBe("Sync finished with 1 channel unfinished");
    const two = fakeProgress({ status: "partial", gaps: [fakeGap(), fakeGap({ channelId: "chan-2" })] });
    expect(statusHeadline("partial", two)).toBe("Sync finished with 2 channels unfinished");
  });

  test("cancelling names the real bound — one in-flight request, not the retry ladder", () => {
    expect(statusHeadline("cancelling", fakeProgress({ cancelRequested: true }))).toBe("Cancelling — waiting for the request already in flight");
  });

  test("cancelling promises no completion it cannot deliver, and names no engine-owned timeout", () => {
    const detail = statusDetail("cancelling", fakeProgress({ cancelRequested: true })) ?? "";
    expect(detail).toMatch(/abandoned/i);
    expect(detail).toMatch(/won't complete/i);
    // The IG request timeout is the engine's number to own; quoting it here is how this
    // copy drifts out of date the moment it is tuned.
    expect(detail).not.toMatch(/\d+\s*(s\b|sec|second)/i);
  });

  test("cancelling does not say where the interrupted channel will appear — that isn't known yet", () => {
    // The engine has two cancel outcomes: mid-retry produces a gap, a healthy in-flight
    // request produces none. The run has not finalized while `cancelling`, so promising
    // either would send half of those users hunting a list the channel isn't in.
    const detail = statusDetail("cancelling", fakeProgress({ cancelRequested: true })) ?? "";
    expect(detail).not.toMatch(/listed below/i);
    expect(detail).not.toMatch(/reported as unfinished/i);
  });

  test("cancelled makes clear that work already saved is kept", () => {
    expect(statusDetail("cancelled", fakeProgress({ status: "partial", stopReason: "cancelled" }))).toMatch(/kept/);
  });

  test("cancel outcome 1 — interrupted mid-retry: the gap is tied to the cancel, not left looking unrelated", () => {
    // The engine rethrows the original IgError, so the user cancels and is then shown
    // "Instagram is throttling us" as if something else had gone wrong.
    const withGaps = fakeProgress({ status: "partial", stopReason: "cancelled", gaps: [fakeGap({ code: "IG_RATE_LIMITED" })] });
    const detail = statusDetail("cancelled", withGaps) ?? "";
    expect(detail).toMatch(/interrupted mid-retry/i);
    expect(detail).toMatch(/not with the cancel/i);
  });

  test("cancel outcome 1 does not claim every gap was an interruption", () => {
    // A cancelled run can also carry channels that failed for real earlier, before
    // anyone pressed anything. The wording covers the interrupted one without
    // relabelling the rest.
    const detail = statusDetail("cancelled", fakeProgress({ status: "partial", stopReason: "cancelled", gaps: [fakeGap()] })) ?? "";
    expect(detail).not.toMatch(/channels (still in progress|below) (are|were) (all )?interrupted/i);
    expect(detail).toMatch(/\bA channel\b/);
  });

  test("cancel outcome 2 — stopped mid-healthy-request: no gap exists, so the reader is not sent to look for one", () => {
    // The engine records no gap and leaves channels.sync_error untouched: nothing about
    // that channel is broken. The only evidence is channelsDone < channelsTotal.
    const noGaps = fakeProgress({ status: "partial", stopReason: "cancelled", gaps: [] });
    const detail = statusDetail("cancelled", noGaps) ?? "";
    expect(detail).not.toMatch(/listed below/i);
    expect(detail).toMatch(/left untouched/i);
    expect(detail).toMatch(/nothing is recorded against them/i);
  });

  test("failed prefers the recorded message over the bare code", () => {
    const progress = fakeProgress({ status: "failed", errorCode: "IG_SERVICE_DOWN", errorMessage: "connection refused" });
    expect(statusDetail("failed", progress)).toBe("connection refused");
  });

  test("failed with only a code still produces a sentence", () => {
    const progress = fakeProgress({ status: "failed", errorCode: "IG_UNKNOWN", errorMessage: null });
    expect(statusDetail("failed", progress)).toBe("Error code IG_UNKNOWN.");
  });

  test("a finished run explains why it stopped", () => {
    expect(statusDetail("success", fakeProgress({ status: "success", stopReason: "lookback" }))).toBe(
      "The run reached the lookback boundary.",
    );
    expect(statusDetail("success", fakeProgress({ status: "success", stopReason: null }))).toBeNull();
  });

  test("idle is explicit that there is no sync_jobs row", () => {
    expect(statusHeadline("idle", null)).toBe("No sync has run yet");
    expect(statusDetail("idle", null)).toMatch(/sync_jobs/);
  });
});

describe("stopReasonLabel", () => {
  test("every reason in the contract has words", () => {
    expect(stopReasonLabel("lookback")).toBe("reached the lookback boundary");
    expect(stopReasonLabel("cap")).toBe("hit the per-sync cap");
    expect(stopReasonLabel("exhausted")).toBe("ran out of posts");
    expect(stopReasonLabel("error")).toBe("stopped on an error");
    expect(stopReasonLabel(null)).toBeNull();
  });

  test("its words reach the screen through statusDetail, which is its only caller", () => {
    // Guards against the function being read as unreferenced and deleted: this is the
    // path that renders it.
    expect(statusDetail("success", fakeProgress({ status: "success", stopReason: "cap" }))).toBe("The run hit the per-sync cap.");
    expect(statusDetail("partial", fakeProgress({ status: "partial", stopReason: "exhausted" }))).toBe("The run ran out of posts.");
  });

  test("the `cancelled` mapping is deliberately never rendered — richer copy intercepts it", () => {
    // `cancelled` exists only to keep STOP_REASON_LABEL exhaustive over StopReason. A
    // cancelled run is routed by syncViewState to copy that says which of the engine's
    // two cancel outcomes happened, which beats "The run cancelled."
    const cancelled = fakeProgress({ status: "partial", stopReason: "cancelled", finishedAt: START });
    expect(syncViewState(cancelled, false)).toBe("cancelled");
    expect(statusDetail(syncViewState(cancelled, false), cancelled)).not.toBe("The run cancelled.");
    expect(statusDetail(syncViewState(cancelled, false), cancelled)).toMatch(/kept/);
  });
});

describe("pollIntervalMs", () => {
  test("a hidden tab polls nothing at all", () => {
    expect(pollIntervalMs({ visible: false, running: true })).toBeNull();
    expect(pollIntervalMs({ visible: false, running: false })).toBeNull();
  });

  test("a visible run polls fast", () => {
    expect(pollIntervalMs({ visible: true, running: true })).toBe(ACTIVE_POLL_MS);
    expect(ACTIVE_POLL_MS).toBe(1_000);
  });

  test("idle still polls, so a sync started by the scheduler or another tab appears", () => {
    expect(pollIntervalMs({ visible: true, running: false })).toBe(IDLE_POLL_MS);
    expect(IDLE_POLL_MS).toBe(10_000);
  });
});

describe("reducePoll", () => {
  const empty: PollState = { progress: null, coverage: null, error: null };

  test("a good poll replaces the progress and clears any previous error", () => {
    const fresh = fakeProgress({ channelsDone: 2 });
    const prev: PollState = { progress: fakeProgress(), coverage: "channel", error: "earlier failure" };
    const next = reducePoll(prev, { ok: true, progress: fresh, coverage: "library" });
    expect(next).toEqual({ progress: fresh, coverage: "library", error: null });
  });

  test("a failed poll keeps the last good value on screen and surfaces the error", () => {
    const rendered = fakeProgress({ channelsDone: 2 });
    const next = reducePoll({ progress: rendered, coverage: "channel", error: null }, { ok: false, error: "fetch failed" });
    expect(next.progress).toBe(rendered);
    expect(next.coverage).toBe("channel");
    expect(next.error).toBe("fetch failed");
  });

  test("a failed poll with nothing rendered yet still reports the error", () => {
    expect(reducePoll(empty, { ok: false, error: "offline" })).toEqual({ progress: null, coverage: null, error: "offline" });
  });

  test("'nothing running' does not erase the summary of the run just watched", () => {
    const finished = fakeProgress({ status: "success", finishedAt: START });
    const next = reducePoll({ progress: finished, coverage: "library", error: null }, { ok: true, progress: null, coverage: null });
    expect(next.progress).toBe(finished);
    // The remembered run is still the run that coverage described.
    expect(next.coverage).toBe("library");
  });

  test("but a fresh run does replace that summary", () => {
    const finished = fakeProgress({ status: "success", finishedAt: START });
    const started = fakeProgress({ jobId: "job-2" });
    const prev: PollState = { progress: finished, coverage: null, error: null };
    const next = reducePoll(prev, { ok: true, progress: started, coverage: "channel" });
    expect(next.progress).toBe(started);
    expect(next.coverage).toBe("channel");
  });

  test("a running row genuinely disappearing is allowed to clear", () => {
    const prev: PollState = { progress: fakeProgress(), coverage: "channel", error: null };
    const next = reducePoll(prev, { ok: true, progress: null, coverage: null });
    expect(next.progress).toBeNull();
    expect(next.coverage).toBeNull();
  });
});

describe("isSyncStalled (re-exported so panel, hook and engine share one rule)", () => {
  test("a fresh heartbeat on a running row is healthy", () => {
    const now = new Date(START).getTime() + 10_000;
    expect(isSyncStalled(fakeProgress(), now)).toBe(false);
  });

  test("a quiet heartbeat on a running row is a dead process holding the lock", () => {
    const now = new Date(START).getTime() + 91_000;
    expect(isSyncStalled(fakeProgress(), now)).toBe(true);
  });

  test("a finished run is never stalled however old its heartbeat", () => {
    const now = new Date(START).getTime() + 9_000_000;
    expect(isSyncStalled(fakeProgress({ status: "success", finishedAt: START }), now)).toBe(false);
  });
});
