/**
 * @vitest-environment jsdom
 *
 * The panel is props-driven, but it is now built out of shadcn compositions (Card, Item,
 * ButtonGroup, Spinner) whose markup is not this file's business. So the assertions here
 * go through the accessibility tree and the rendered text — `getByRole("progressbar")`
 * and its aria values, buttons by accessible name — rather than through raw HTML
 * substrings, which is what this file used to do and what made a re-composition of the
 * panel look like a behaviour regression.
 *
 * Environment is declared per-file, the same convention `failure-strip.test.tsx` and
 * `logs-view.test.tsx` follow: vitest defaults to node here and only the files that
 * touch a DOM opt in.
 *
 * `@testing-library/jest-dom` isn't a dependency (see `package.json`), so assertions
 * read straight off the node — `.textContent`, `.getAttribute`, `.hasAttribute`. And
 * vitest runs without `globals: true`, so testing-library's auto-cleanup never
 * registers: every test renders through `panel()` and `afterEach` calls `cleanup()`.
 *
 * Clicks are still out of scope: the handlers are one-liners forwarding to props, and
 * the props' own logic is covered in `sync-progress-view.test.ts` and by the hook's
 * callers.
 */

import { cleanup, render, type RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import type { SyncGap, SyncProgress } from "@/server/services/sync-types";
import { SyncProgressPanel } from "./sync-progress-panel";

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

interface Panel extends RenderResult {
  /** Visible text, whitespace-collapsed, so assertions read like the panel does. */
  text: string;
  progressBar: HTMLElement | null;
  /** The filled part of the bar. Base UI gives it an inline `width` only when the
   *  progress is determinate, which is exactly the distinction this panel cares about. */
  indicatorWidth: string;
}

function panel(props: Partial<React.ComponentProps<typeof SyncProgressPanel>> = {}): Panel {
  const utils = render(
    <SyncProgressPanel progress={fakeProgress()} stalled={false} onCancel={noop} onRetry={noop} {...props} />,
  );
  const indicator = utils.container.querySelector<HTMLElement>('[data-slot="progress-indicator"]');
  return {
    ...utils,
    text: (utils.container.textContent ?? "").replace(/\s+/g, " ").trim(),
    progressBar: utils.queryByRole("progressbar"),
    indicatorWidth: indicator?.style.width ?? "",
  };
}

afterEach(cleanup);

describe("idle — no sync_jobs row at all", () => {
  test("says so plainly instead of showing a bar at zero", () => {
    const { text } = panel({ progress: null });
    expect(text).toContain("No sync has run yet");
    expect(text).toContain("Nothing in sync_jobs to report.");
  });

  test("draws no progressbar and no counters", () => {
    const { progressBar, text } = panel({ progress: null });
    expect(progressBar).toBeNull();
    expect(text).not.toContain("assets saved");
  });

  test("offers no cancel for a run that isn't happening", () => {
    const { queryByRole } = panel({ progress: null });
    expect(queryByRole("button", { name: /cancel/i })).toBeNull();
  });
});

describe("running — determinate on channels", () => {
  test("the bar's aria values are the real channel counts", () => {
    const { progressBar } = panel();
    expect(progressBar).not.toBeNull();
    expect(progressBar?.getAttribute("aria-valuemin")).toBe("0");
    expect(progressBar?.getAttribute("aria-valuemax")).toBe("4");
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("1");
    expect(progressBar?.getAttribute("aria-valuetext")).toBe("1 of 4 channels");
  });

  test("the drawn width is the same fraction, not an approximation of it", () => {
    const { indicatorWidth, text } = panel();
    expect(indicatorWidth).toBe("25%");
    expect(text).toContain("1 / 4 · 25%");
  });

  test("the headline is the phase plus the channel being worked", () => {
    expect(panel().text).toContain("Fetching posts — @hormozi");
  });

  test("items are a count against the cap and are given no percentage", () => {
    const { text } = panel();
    expect(text).toContain("120 / 500 (cap)");
    expect(text).toMatch(/only denominator/);
    // 24% would be itemsSeen/maxItems dressed up as progress. It must not appear.
    expect(text).not.toContain("24%");
  });

  test("every counter is on screen", () => {
    const { text } = panel();
    for (const label of ["created", "updated", "failed", "deleted", "assets saved", "assets failed"]) {
      expect(text).toContain(label);
    }
  });

  test("elapsed time comes from startedAt", () => {
    const { text } = panel({ progress: fakeProgress({ startedAt: new Date(Date.now() - 65_000).toISOString() }) });
    expect(text).toContain("running for 1:05");
  });

  test("cancel is offered and enabled", () => {
    const { getByRole } = panel();
    // `ui/button.tsx` is Base UI's Button with the default `focusableWhenDisabled`, so
    // an unpressable button carries the native `disabled` attribute, not aria-disabled.
    expect(getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(false);
  });

  test("status changes are announced", () => {
    const { getByRole } = panel();
    const status = getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  test("the panel is a named region, so a host screen can point at it", () => {
    const { getByRole } = panel();
    expect(getByRole("region", { name: "Sync progress" })).not.toBeNull();
  });

  test("zero retries says nothing at all", () => {
    expect(panel().text).not.toContain("retried");
  });

  test("non-zero retries read as recovery, not as an error", () => {
    expect(panel({ progress: fakeProgress({ retries: 3 }) }).text).toContain("retried 3 times");
  });
});

describe("running — channel list not yet resolved", () => {
  const unresolved = () => panel({ progress: fakeProgress({ channelsTotal: null, channelsDone: 0, phase: "starting" }) });

  test("the bar is indeterminate rather than sitting at a made-up zero", () => {
    const { progressBar } = unresolved();
    expect(progressBar?.hasAttribute("data-indeterminate")).toBe(true);
    expect(progressBar?.hasAttribute("aria-valuenow")).toBe(false);
  });

  test("and it says why", () => {
    const { text, progressBar } = unresolved();
    expect(text).toContain("resolving channels");
    expect(text).toContain("hasn't enumerated its channel list yet");
    expect(progressBar?.getAttribute("aria-valuetext")).toBe("resolving the channel list");
  });

  test("nothing is drawn: the indicator gets no width, so there is no bar pretending to fill", () => {
    expect(unresolved().indicatorWidth).toBe("");
  });
});

describe("cancelling", () => {
  const cancelling = () => panel({ progress: fakeProgress({ cancelRequested: true }) });

  test("the button reports the request, and can't be pressed twice", () => {
    const { getByRole } = cancelling();
    expect(getByRole("button", { name: "Cancelling…" }).hasAttribute("disabled")).toBe(true);
  });

  test("the headline explains that cancellation is co-operative", () => {
    expect(cancelling().text).toContain("Cancelling — waiting for the request already in flight");
  });

  test("it does not promise the channel in progress will finish", () => {
    // The engine abandons the remaining retry budget on cancel, so saying the channel is
    // being "finished" would be a promise the engine does not keep.
    const { text } = cancelling();
    expect(text).not.toContain("finishing the current channel");
    expect(text).toContain("won't complete");
    expect(text).toContain("Everything already saved is kept");
  });

  test("nor does it say where that channel will turn up — the run hasn't finalized", () => {
    // Mid-retry it becomes a gap; on a healthy in-flight request it becomes no gap at
    // all. Neither is known while the row is still `running`.
    expect(cancelling().text).not.toContain("listed below");
  });
});

describe("stalled", () => {
  test("says the run stopped reporting rather than pretending it is working", () => {
    const { text } = panel({ stalled: true });
    expect(text).toContain("This sync stopped reporting");
    expect(text).toContain("died holding the sync lock");
  });

  test("offers the recovery", () => {
    const { getByRole } = panel({ stalled: true });
    expect(getByRole("button", { name: "Start a new sync" })).not.toBeNull();
  });

  test("does not offer a cancel that a dead process can never honour", () => {
    const { queryByRole } = panel({ stalled: true });
    expect(queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  test("outranks a cancel request that will never be serviced", () => {
    const { text, queryByRole } = panel({ progress: fakeProgress({ cancelRequested: true }), stalled: true });
    expect(text).toContain("This sync stopped reporting");
    expect(queryByRole("button", { name: /cancelling/i })).toBeNull();
    expect(text).not.toContain("Cancelling…");
  });
});

describe("terminal — success", () => {
  const success = () =>
    panel({
      progress: fakeProgress({ status: "success", finishedAt: "2026-07-28T10:02:00.000Z", channelsDone: 4, stopReason: "lookback" }),
    });

  test("names the counts behind the verdict", () => {
    expect(success().text).toContain("Sync finished — 40 new, 8 updated");
  });

  test("says why it stopped, and reports a settled duration", () => {
    const { text } = success();
    expect(text).toContain("The run reached the lookback boundary.");
    expect(text).toContain("took 2:00");
  });

  test("no cancel on a finished run", () => {
    expect(success().queryByRole("button", { name: /cancel/i })).toBeNull();
  });
});

describe("terminal — partial, with per-channel failures", () => {
  const gaps = [
    fakeGap({ channelId: "chan-1", handle: "@hormozi", code: "IG_AUTH_REQUIRED", error: "401" }),
    fakeGap({ channelId: "chan-2", handle: "@garyvee", code: "IG_PRIVATE", error: "private" }),
  ];
  const partial = () => panel({ progress: fakeProgress({ status: "partial", finishedAt: START, channelsDone: 2, gaps }) });

  test("counts the unfinished channels in the headline", () => {
    const { text } = partial();
    expect(text).toContain("Sync finished with 2 channels unfinished");
    expect(text).toContain("2 channels didn't finish");
  });

  test("each gap is named by handle, not by id", () => {
    const { text } = partial();
    expect(text).toContain("@hormozi");
    expect(text).toContain("@garyvee");
    expect(text).not.toContain("chan-1");
  });

  test("each code becomes an actionable sentence — never a bare code", () => {
    const { text } = partial();
    expect(text).toContain("The Instagram session has expired. Re-import it in Settings");
    expect(text).toContain("This account is private");
  });

  test("a hopeless retry is labelled as such", () => {
    const { getByRole } = partial();
    expect(getByRole("button", { name: "Retry @hormozi" })).not.toBeNull();
    expect(getByRole("button", { name: "Retry anyway @garyvee" })).not.toBeNull();
  });

  test("a gap with no handle is still named, and its retry button still labelled", () => {
    // 10 of the 12 gap rows in the live database pre-date the handle column and carry "".
    // That rendered a nameless row and a button whose entire accessible name was "Retry ".
    const legacy = panel({
      progress: fakeProgress({ status: "partial", finishedAt: START, gaps: [fakeGap({ handle: "", channelId: "chan-7" })] }),
    });
    expect(legacy.text).toContain("channel chan-7");
    expect(legacy.getByRole("button", { name: "Retry channel chan-7" })).not.toBeNull();
    expect(legacy.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("a single retry-them-all button is offered too", () => {
    expect(partial().getByRole("button", { name: "Retry 2 failed" })).not.toBeNull();
  });

  test("singular when only one channel failed", () => {
    const one = panel({ progress: fakeProgress({ status: "partial", finishedAt: START, gaps: [gaps[0]] }) });
    expect(one.text).toContain("Sync finished with 1 channel unfinished");
    expect(one.getByRole("button", { name: "Retry 1 failed" })).not.toBeNull();
  });
});

describe("terminal — failed", () => {
  test("the message is what the user reads; the code is only supporting evidence", () => {
    const { text } = panel({
      progress: fakeProgress({
        status: "failed",
        finishedAt: START,
        stopReason: "error",
        errorCode: "IG_SERVICE_DOWN",
        errorMessage: "connection refused to http://127.0.0.1:8765",
      }),
    });
    expect(text).toContain("Sync failed");
    expect(text).toContain("connection refused to http://127.0.0.1:8765");
    expect(text.indexOf("connection refused")).toBeLessThan(text.indexOf("IG_SERVICE_DOWN"));
  });
});

describe("terminal — failed with every channel gapped", () => {
  // Engine audit F11: a run where nothing succeeded now records `failed` rather than
  // `partial`. The panel must not report total failure as partial success.
  const gaps = [
    fakeGap({ channelId: "chan-1", handle: "@hormozi", code: "IG_AUTH_REQUIRED", error: "session expired" }),
    fakeGap({ channelId: "chan-2", handle: "@garyvee", code: "IG_AUTH_REQUIRED", error: "session expired" }),
  ];
  const allGapped = () =>
    panel({
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
    const { text } = allGapped();
    expect(text).toContain("Sync failed");
    expect(text).not.toContain("Sync finished");
  });

  test("still lists every channel with its own actionable message and retry", () => {
    const { text, getByRole } = allGapped();
    expect(text).toContain("2 channels didn't finish");
    expect(text).toContain("The Instagram session has expired. Re-import it in Settings");
    expect(getByRole("button", { name: "Retry @hormozi" })).not.toBeNull();
    expect(getByRole("button", { name: "Retry 2 failed" })).not.toBeNull();
  });

  test("the bar honestly shows nothing got done", () => {
    const { progressBar, text } = allGapped();
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("0");
    expect(text).toContain("0 / 4 · 0%");
  });
});

describe("terminal — cancelled", () => {
  const cancelled = () => panel({ progress: fakeProgress({ status: "partial", finishedAt: START, stopReason: "cancelled" }) });

  test("is not reported as a failure", () => {
    const { text } = cancelled();
    expect(text).toContain("Sync cancelled");
    expect(text).not.toContain("Sync failed");
  });

  test("promises that saved work survives", () => {
    expect(cancelled().text).toContain("Everything saved before the cancel is kept");
  });

  test("stopped mid-healthy-request: no gap list, and the reader isn't sent hunting for one", () => {
    // The engine records no gap here and leaves the channel's sync_error untouched. The
    // only trace is the bar showing 1 of 4 done.
    const { text, queryByRole, progressBar } = cancelled();
    expect(text).toContain("left untouched");
    expect(text).not.toContain("didn't finish");
    expect(queryByRole("button", { name: /Retry \d+ failed/ })).toBeNull();
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("1");
  });

  test("interrupted mid-retry: the gap is explained rather than left looking unrelated", () => {
    const { text } = panel({
      progress: fakeProgress({
        status: "partial",
        finishedAt: START,
        stopReason: "cancelled",
        gaps: [fakeGap({ handle: "@hormozi", code: "IG_RATE_LIMITED", error: "429" })],
      }),
    });
    expect(text).toContain("Sync cancelled");
    expect(text).toContain("interrupted mid-retry");
    // The gap still carries its real upstream reason, which is the whole confusion the
    // sentence above exists to defuse.
    expect(text).toContain("Instagram is throttling us");
  });
});

describe("a broken poll", () => {
  test("does not blank the numbers already on screen", () => {
    const { text } = panel({ pollError: "fetch failed" });
    expect(text).toContain("Fetching posts — @hormozi");
    expect(text).toContain("120 / 500 (cap)");
  });

  test("and admits that they are stale", () => {
    const { text } = panel({ pollError: "fetch failed" });
    expect(text).toContain("Progress updates are failing: fetch failed");
    expect(text).toContain("the last ones that arrived");
  });

  test("with nothing rendered yet it reports the error on its own", () => {
    const { text } = panel({ progress: null, pollError: "offline" });
    expect(text).toContain("Progress updates are failing: offline");
    expect(text).not.toContain("the last ones that arrived");
  });
});
