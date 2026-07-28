/**
 * The arithmetic and the wording behind the live sync panel, kept out of the JSX.
 *
 * Two reasons, both practical. This repo runs vitest in node with no jsdom and no
 * testing-library, so a rendered assertion is not available — the only way these
 * decisions get covered at all is as plain functions. And every number the panel puts
 * on screen has to trace back to a real `sync_jobs` column; that is far easier to keep
 * true when the mapping lives in one tested file than when it is spread through markup.
 *
 * Nothing here invents a quantity. `channelsDone / channelsTotal` is the only fraction
 * a run actually knows: Instagram paginates until it stops, so there is no denominator
 * for the item count except the configured cap, and the cap is a ceiling, not a target.
 */

import {
  SYNC_STALL_SECONDS,
  isSyncStalled,
  type StopReason,
  type SyncGap,
  type SyncPhase,
  type SyncProgress,
} from "@/server/services/sync-types";

const PHASE_LABEL: Record<SyncPhase, string> = {
  starting: "Starting up",
  profile: "Reading the profile",
  fetching: "Fetching posts",
  saving: "Saving posts and thumbnails",
  retrying: "Backing off after an upstream error",
  scoring: "Scoring outliers",
  finalizing: "Finishing up",
};

/** A `running` row can carry a null phase — it was written by an engine build older than
 *  the phase column, or the very first flush hasn't landed. Say something true rather
 *  than guessing at "Starting up", which is a specific claim about where the run is. */
export function phaseLabel(phase: SyncPhase | null): string {
  return phase === null ? "Working" : PHASE_LABEL[phase];
}

/**
 * `Record<StopReason, string>` rather than a partial map on purpose: when the engine adds
 * a stop reason this stops compiling until someone writes words for it, which is cheaper
 * than discovering the gap as a blank line on screen.
 *
 * `cancelled` is mapped but never rendered through here — `syncViewState` intercepts a
 * cancelled run before `statusDetail` reaches its success/partial branch, and routes it
 * to copy that explains which of the engine's two cancel outcomes happened. That is much
 * better than "The run cancelled." The entry exists to satisfy the exhaustiveness above,
 * and the interception is asserted in the tests so nobody later "fixes" the apparent
 * inconsistency by wiring it up and losing the richer wording.
 */
const STOP_REASON_LABEL: Record<StopReason, string> = {
  lookback: "reached the lookback boundary",
  cap: "hit the per-sync cap",
  exhausted: "ran out of posts",
  error: "stopped on an error",
  cancelled: "cancelled",
};

/** Exported for its own exhaustive test; the only production caller is `statusDetail`
 *  below, which is what puts these words on screen. */
export function stopReasonLabel(reason: StopReason | null): string | null {
  return reason === null ? null : STOP_REASON_LABEL[reason];
}

/**
 * IgErrorCode -> a sentence that tells the user what to do about *this* channel.
 *
 * Deliberately not `IgError.userMessage`: that copy is written for the connection panel
 * ("Sync will back off and retry"), which is the wrong tense next to a channel that has
 * already failed and is offering a retry button. The codes themselves are the contract
 * (src/server/ig/errors.ts); the wording is this surface's own.
 */
const GAP_MESSAGE: Record<string, string> = {
  IG_AUTH_REQUIRED: "The Instagram session has expired. Re-import it in Settings, then retry this channel.",
  IG_BAD_CREDENTIALS: "Instagram rejected the saved credentials. Fix them in Settings before retrying.",
  IG_TWO_FACTOR: "Instagram wants a two-factor code. Enter it in Settings, then retry this channel.",
  IG_CHALLENGE: "Instagram issued a security challenge. Resolve it in Settings, then retry this channel.",
  IG_RATE_LIMITED: "Instagram is throttling us. Nothing is broken — leave it a few minutes and retry.",
  IG_NOT_FOUND: "This account no longer exists on Instagram. That's about the account, not about this app.",
  IG_PRIVATE: "This account is private, so its posts can't be read. That's about the account, not about this app.",
  IG_PROXY_BLOCKED: "Instagram is blocking the configured proxy. Change or remove it in .env.local.",
  IG_NETWORK: "The network call to Instagram failed. Usually transient — retry.",
  IG_ASSET_DOWNLOAD: "Posts were read, but an image or video wouldn't download. Retry to pick up the missing files.",
  IG_DRIFT: "Instagram's response no longer matches what this app expects — the mapper needs updating in code.",
  IG_SERVICE_DOWN: "The local Instagram sidecar isn't running. Start it with `npm run ig:service`, then retry.",
  IG_SERVICE_UNAUTHORIZED:
    "This app and the Instagram sidecar disagree about IG_SERVICE_TOKEN. That's a config fault on our side — check .env.local.",
};

/** A raw code is never rendered on its own: it means nothing to the person reading it.
 *  An unmapped code falls back to whatever the engine recorded, which is at least prose. */
export function gapMessage(gap: Pick<SyncGap, "code" | "error">): string {
  const mapped = gap.code === null ? undefined : GAP_MESSAGE[gap.code];
  if (mapped !== undefined) return mapped;
  if (gap.error.trim().length > 0) return gap.error;
  return "This channel failed and the sync engine recorded no reason.";
}

/** Codes where nothing about a retry can change the outcome — the account is gone or
 *  private, or our mapper is out of date. The button still exists (the user may know
 *  something we don't) but it must not be presented as the fix. */
const RETRY_WONT_HELP: ReadonlySet<string> = new Set(["IG_NOT_FOUND", "IG_PRIVATE", "IG_DRIFT", "IG_BAD_CREDENTIALS"]);

/**
 * What to call the channel in a gap row.
 *
 * `handle` is only as good as the row that recorded it: gaps written before the column
 * existed carry `""`, and 10 of the 12 gap rows in the live database are that old. Put
 * straight into the markup that produced a nameless failure and a button whose entire
 * accessible name was "Retry ", which tells a screen-reader user nothing about what they
 * are about to retry. The channel id is ugly but it is identifiable and it is always
 * there; only if that is empty too do we admit we cannot name the thing.
 */
export function gapDisplayName(gap: Pick<SyncGap, "handle" | "channelId">): string {
  const handle = gap.handle.trim();
  if (handle.length > 0) return handle;
  const channelId = gap.channelId.trim();
  return channelId.length > 0 ? `channel ${channelId}` : "an unnamed channel";
}

export function gapRetryLabel(code: string | null): "Retry" | "Retry anyway" {
  return code !== null && RETRY_WONT_HELP.has(code) ? "Retry anyway" : "Retry";
}

/**
 * The determinate fraction, or null when the run hasn't enumerated its channels yet.
 * Clamped because a resumed run can report `channelsDone` above a `channelsTotal` that
 * was written before a channel was added.
 */
export function channelPercent(done: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** Wall-clock duration of the run: to `finishedAt` once it has one, to now while it
 *  hasn't. Both endpoints are real columns — nothing here is a ticking animation. */
export function elapsedMs(p: Pick<SyncProgress, "startedAt" | "finishedAt">, now = Date.now()): number {
  const start = new Date(p.startedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  const end = p.finishedAt === null ? now : new Date(p.finishedAt).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

/** 65_000 -> "1:05", 3_725_000 -> "1:02:05". M:SS below an hour, H:MM:SS above. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(hours > 0 ? 2 : 1, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

/** Items get a ratio against the cap and nothing else. The cap is a ceiling the run may
 *  never approach (it usually stops at the lookback boundary first), so turning this
 *  into a percentage would draw a bar that fills at a rate meaning nothing. */
export function formatItemsAgainstCap(seen: number, maxItems: number): string {
  return `${seen} / ${maxItems} (cap)`;
}

/** "retried 3 times" — recovery that already happened, not an error. Null when zero, so
 *  the caller renders nothing rather than a reassuring "retried 0 times". */
export function retriesLabel(retries: number): string | null {
  if (retries <= 0) return null;
  return retries === 1 ? "retried once" : `retried ${retries} times`;
}

/** Every distinct thing the panel can be showing. All eight are reachable. */
export type SyncViewState = "idle" | "running" | "stalled" | "cancelling" | "cancelled" | "success" | "partial" | "failed";

/**
 * A stalled run outranks a cancelling one: if the process died holding the lock, the
 * cancel it was asked for is never going to be honoured, and saying "cancelling…"
 * forever is the exact lie this panel exists to stop telling.
 */
export function syncViewState(progress: SyncProgress | null, stalled: boolean): SyncViewState {
  if (progress === null) return "idle";
  if (progress.status === "running") {
    if (stalled) return "stalled";
    return progress.cancelRequested ? "cancelling" : "running";
  }
  // `status` and `stopReason` are independent by design — "did the work get done" and
  // "why did it stop" are different questions, and a cancel can land on a run that had
  // already achieved nothing. Reading only `stopReason` here collapsed the two and
  // reported a total failure as a benign cancellation: two rows in the live database are
  // `failed | cancelled | IG_NETWORK` with zero channels synced, and they rendered amber
  // "Sync cancelled — everything saved before the cancel is kept" while the Settings
  // summary, reading the same row, said "failed".
  //
  // `success`/`partial` + `cancelled` genuinely is a cancellation: real work landed and
  // the user stopped it. `failed` + `cancelled` is a failure that happens to have been
  // cancelled, and the failure is the part that must not be swallowed.
  if (progress.stopReason === "cancelled" && progress.status !== "failed") return "cancelled";
  return progress.status;
}

export type SyncTone = "idle" | "busy" | "ok" | "warn" | "bad";

export function stateTone(state: SyncViewState): SyncTone {
  switch (state) {
    case "idle":
      return "idle";
    case "running":
    case "cancelling":
      return "busy";
    case "success":
      return "ok";
    case "partial":
    case "cancelled":
      return "warn";
    case "stalled":
    case "failed":
      return "bad";
  }
}

/** The one line read aloud by the live region. Terminal states name the counts that
 *  justify them so "partial" is never a verdict without evidence. */
export function statusHeadline(state: SyncViewState, progress: SyncProgress | null): string {
  if (progress === null) return "No sync has run yet";
  switch (state) {
    case "idle":
      return "No sync has run yet";
    case "running":
      return progress.currentChannelHandle === null
        ? phaseLabel(progress.phase)
        : `${phaseLabel(progress.phase)} — ${progress.currentChannelHandle}`;
    case "cancelling":
      return "Cancelling — waiting for the request already in flight";
    case "stalled":
      return "This sync stopped reporting";
    case "cancelled":
      return "Sync cancelled";
    case "success":
      return `Sync finished — ${progress.itemsCreated} new, ${progress.itemsUpdated} updated`;
    case "partial":
      return `Sync finished with ${progress.gaps.length} channel${progress.gaps.length === 1 ? "" : "s"} unfinished`;
    case "failed":
      // Both facts or neither. Routing `failed + cancelled` here rather than to
      // "cancelled" stops a total failure reading as benign, but bare "Sync failed"
      // then hides that the user themselves stopped it — which reads as the app
      // breaking on its own. The headline carries the failure and the cause together.
      return progress.stopReason === "cancelled" ? "Sync failed — cancelled before anything synced" : "Sync failed";
  }
}

/** Secondary sentence. Returns null where the headline already said everything true. */
export function statusDetail(state: SyncViewState, progress: SyncProgress | null): string | null {
  if (progress === null) {
    return "Nothing in sync_jobs to report.";
  }
  switch (state) {
    case "idle":
      return "Nothing in sync_jobs to report.";
    case "running":
      return null;
    case "cancelling":
      // Cancel is co-operative, and the honest bound on it is one in-flight request —
      // the engine checks `cancel_requested` before each retry and slices its backoff,
      // so a cancel no longer waits out a ladder that could run to 42 s. The request
      // timeout that actually bounds the wait is the engine's and is not named here.
      //
      // Deliberately says nothing about where the interrupted channel will *appear*.
      // The engine has two cancel outcomes and the run has not finalized yet, so which
      // one applies is genuinely unknown at this moment: a cancel landing mid-retry
      // rethrows the original error and produces a gap, while one landing on a healthy
      // in-flight request produces no gap at all. An earlier draft promised "reported as
      // unfinished", which would send half of those users hunting a failure list for a
      // channel that is correctly absent from it.
      return "Remaining retries are abandoned rather than waited out, so the channel in progress won't complete. Everything already saved is kept.";
    case "stalled":
      // Carefully hedged, and the hedge is the point. The engine flushes progress far
      // more often than SYNC_STALL_SECONDS, so this much silence is genuinely abnormal —
      // but it is *suspicion*, not a death certificate: the stale-lock reaper waits an
      // order of magnitude longer before stealing the lock, so there is a real window in
      // which a run that looks stalled is still alive and goes on to recover.
      //
      // An earlier draft of this sentence asserted the process had died and promised
      // that starting a new sync would take the lock back. Both were false inside that
      // window. The reaper's own timeout is deliberately not named here — it belongs to
      // the engine, and repeating it is how this copy would drift out of date again.
      return `No heartbeat for over ${SYNC_STALL_SECONDS} seconds, and the engine reports far more often than that — so this run has probably died holding the sync lock, though it may yet recover. The lock is only released once the engine's stale-lock timeout passes, so a new sync can be refused until then.`;
    case "cancelled": {
      const kept = "Everything saved before the cancel is kept — the run stopped, it didn't roll back.";
      // The engine has two cancel outcomes and they look different here.
      //
      // Mid-retry: the original IgError is rethrown, so that channel appears below with
      // the error it was retrying. Without a word of explanation that gap reads as an
      // unrelated failure — the user cancelled and is then shown "Instagram is throttling
      // us". Note the wording does not claim *every* gap is an interruption: a run can
      // also carry channels that failed for real earlier, before anyone pressed anything.
      //
      // Healthy request in flight: no gap at all, and the channel's `sync_error` is left
      // untouched, because nothing about it is broken. There the only evidence is
      // channelsDone < channelsTotal, so saying "look below" would send the reader to a
      // list the channel is correctly absent from.
      return progress.gaps.length > 0
        ? `${kept} A channel interrupted mid-retry is listed below with the error it was retrying, not with the cancel.`
        : `${kept} Channels that hadn't finished were left untouched — nothing is recorded against them.`;
    }
    case "success":
    case "partial": {
      const reason = stopReasonLabel(progress.stopReason);
      return reason === null ? null : `The run ${reason}.`;
    }
    case "failed": {
      // errorCode alone is never enough for a reader; it is shown next to the message,
      // not instead of it.
      const why = progress.errorMessage ?? (progress.errorCode === null ? "The sync engine recorded no reason." : `Error code ${progress.errorCode}.`);
      // Reconciles this panel with the Settings summary, which reads "failed · was
      // cancelled" off the same row. Without it the two surfaces look like they disagree,
      // and the user is left deciding which one to believe.
      return progress.stopReason === "cancelled" ? `Nothing had synced when the cancel landed, so this is recorded as a failure rather than a cancellation. ${why}` : why;
    }
  }
}

export const ACTIVE_POLL_MS = 1_000;
export const IDLE_POLL_MS = 10_000;

/**
 * How often to ask the server, or null for "don't". A hidden tab polls nothing: a
 * background tab burning a request a second for hours is real cost for information
 * nobody can see. The idle poll is not decoration either — a run started by the
 * scheduler or from another browser tab has to appear here without anyone clicking.
 */
export function pollIntervalMs(opts: { visible: boolean; running: boolean }): number | null {
  if (!opts.visible) return null;
  return opts.running ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}

/**
 * Whether the run on screen covers the channel being asked about: its own run, or a
 * library-wide run that includes it. Null when nothing covers it — or when the caller
 * asked globally, where the question has no meaning.
 *
 * It comes from the `channel_id` column, which is the only thing that actually answers
 * it. The UI's previous answer was to string-compare `currentChannelHandle` against the
 * row's handle and treat a null handle as "ours", which is wrong for the whole of phase
 * `starting`, before the run has named a channel.
 */
export type SyncCoverage = "channel" | "library" | null;

export interface PollState {
  progress: SyncProgress | null;
  coverage: SyncCoverage;
  error: string | null;
}

export type PollOutcome =
  | { ok: true; progress: SyncProgress | null; coverage: SyncCoverage }
  | { ok: false; error: string };

/**
 * A failed poll is not evidence that the run vanished. Keep the last good row on screen
 * and surface the error alongside it — blanking a half-rendered sync because one fetch
 * lost its connection is worse than briefly showing a value a second out of date.
 */
export function reducePoll(prev: PollState, outcome: PollOutcome): PollState {
  if (!outcome.ok) return { progress: prev.progress, coverage: prev.coverage, error: outcome.error };
  if (outcome.progress === null && prev.progress !== null && prev.progress.status !== "running") {
    // The server reporting "nothing to show" must not erase the summary of the run the
    // user just watched finish. Once a job goes terminal the hook stops asking for it by
    // id and falls back to the unscoped lookup, so this rule is what keeps the result on
    // screen if that lookup ever answers with nothing — a wiped `sync_jobs`, or a future
    // change that makes it consider live runs only.
    // Coverage is held with it: the run being remembered is still the run it described.
    return { progress: prev.progress, coverage: prev.coverage, error: null };
  }
  return { progress: outcome.progress, coverage: outcome.coverage, error: null };
}

/** Re-exported so the panel and the hook agree on one stall rule with the engine. */
export { isSyncStalled };
