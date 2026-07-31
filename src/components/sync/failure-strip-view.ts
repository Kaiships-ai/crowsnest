/**
 * The arithmetic and the wording behind the shell's failure strip, kept out of the JSX
 * for the same reason `sync-progress-view.ts` is: this repo runs vitest in node with no
 * jsdom, so a plain function is the only thing that gets covered at all, and every
 * sentence here has to trace back to a real field on `FailureStrip` (see
 * `src/server/queries/failure-surface.ts`) rather than to a guess dressed as copy.
 *
 * Deliberately NOT reusing `GAP_MESSAGE` from `sync-progress-view.ts` for the strip's
 * headline, even though the codes overlap. That map is written in the voice of one gap
 * row that already has a "Retry" button next to it ("...then retry this channel."). The
 * whole point of `failure-surface.ts` is that a connection-level code is a fact about the
 * one Instagram session the app shares, not about whichever channel happened to surface
 * it — reusing "retry this channel" at the strip level would put the exact bug this
 * module exists to prevent back on screen, just one layer up. So every sentence below is
 * written fresh, in the connection's voice, and only the raw `errorCode` is shared
 * between the two surfaces.
 */

import type { FailureStrip, FailureStripGap, FailureStripKind } from "@/server/queries/failure-surface";

/** `none` and `running` never reach the screen here — `none` has nothing to report, and
 *  `running` is the live progress panel's story to tell (see `getFailureStrip`'s own
 *  doc: "the shell hides this strip and shows the seven-phase progress bar instead"). */
export type FailureStripTone = "warn" | "bad";

/** Whether the strip renders at all, and how loud. `partial` is the one kind where the
 *  connection is fine and only some channels of many didn't finish — the same register
 *  `sync-progress-view.ts`'s `stateTone` gives a partial run. Every connection-level kind
 *  (the burner itself is blocked) reads as the harder tone. */
export function failureStripTone(kind: FailureStripKind): FailureStripTone | null {
  switch (kind) {
    case "none":
    case "running":
      return null;
    case "partial":
      return "warn";
    case "service_down":
    case "session_expired":
    case "cooldown":
    case "offline":
    case "failed":
      return "bad";
  }
}

const TITLE: Record<Exclude<FailureStripKind, "none" | "running">, string> = {
  service_down: "Local service down",
  session_expired: "Session expired",
  cooldown: "Cooling down",
  offline: "No network",
  partial: "Partial sync",
  failed: "Sync failed",
};

export function failureStripTitle(kind: FailureStripKind): string {
  return kind === "none" || kind === "running" ? "" : TITLE[kind];
}

/** What the run kept, in the two units the query actually reports — never a total post
 *  count, because Instagram never gives one (see `sync-progress-view.ts`'s own note on
 *  `formatItemsAgainstCap`). `null` means the run recorded nothing usable at all, which
 *  is a different, worse fact than zero and says so plainly rather than printing "0". */
export function formatKeptCounts(kept: FailureStrip["kept"]): string {
  if (kept === null) return "Nothing was recorded as kept before the run stopped";
  const channels =
    kept.channelsSynced !== null && kept.channelsTotal !== null
      ? `${kept.channelsSynced} of ${kept.channelsTotal} channels synced`
      : kept.channelsTotal !== null
        ? `${kept.channelsTotal} channels attempted`
        : null;
  const items = `${kept.itemsCreated} new, ${kept.itemsUpdated} updated`;
  return channels ? `${channels} · ${items}` : items;
}

function partialHeadline(strip: FailureStrip): string {
  const n = strip.gaps.length;
  const channelWord = n === 1 ? "channel" : "channels";
  const lead = n > 0 ? `${n} ${channelWord} didn't finish this run.` : "This run didn't finish everything it started.";
  return `${lead} The rest is intact: ${formatKeptCounts(strip.kept)}.`;
}

/** The primary sentence, in the connection's voice — see the module doc for why this is
 *  hand-written per kind rather than derived from `GAP_MESSAGE`. */
export function failureStripHeadline(strip: FailureStrip): string {
  switch (strip.kind) {
    case "service_down":
      return "The local Instagram sidecar isn't reachable, so sync can't run at all. Start it, then try again.";
    case "session_expired":
      return "The Instagram session has expired. Reconnect it in Settings before the next sync can do anything.";
    case "cooldown":
      // The one sentence this whole file exists to get right: the pause belongs to the
      // connection, never to whichever channel happened to surface it.
      return "Instagram paused the whole connection, not just one channel. It clears on its own.";
    case "offline":
      return "The network call to Instagram failed. Everything already synced stays put, and nothing can refresh until the connection is back.";
    case "partial":
      return partialHeadline(strip);
    case "failed":
      return "Every channel failed on its own terms this run. The connection itself is fine.";
    case "none":
    case "running":
      return "";
  }
}

/** Seconds still to wait, computed from two real facts — when the run finished and the
 *  wait Instagram itself supplied — rather than a client-side guess. Null whenever
 *  Instagram gave no countdown at all (`cooldownRetryAfterSec` is null), which the caller
 *  must render as "the pause is in effect" and never as an invented duration. Clamped at
 *  0 rather than going negative; it does not auto-clear the kind, because only a fresh
 *  `sync_jobs` row — a new run — actually proves the cooldown lifted. */
export function cooldownRemainingSec(strip: Pick<FailureStrip, "finishedAt" | "cooldownRetryAfterSec">, now = Date.now()): number | null {
  if (strip.cooldownRetryAfterSec === null || strip.finishedAt === null) return null;
  const deadlineMs = new Date(strip.finishedAt).getTime() + strip.cooldownRetryAfterSec * 1000;
  if (!Number.isFinite(deadlineMs)) return null;
  return Math.max(0, Math.round((deadlineMs - now) / 1000));
}

/** `null` -> Instagram gave no countdown; `0` -> the wait it gave has already passed;
 *  otherwise the mm:ss still left. Three distinct sentences because they are three
 *  distinct facts, not one number in three states. */
export function formatCooldownWait(remainingSec: number | null): string {
  if (remainingSec === null) return "Instagram didn't say how long the pause lasts, so there is no countdown to show.";
  if (remainingSec === 0) return "The wait Instagram asked for has passed. The next sync will show if it actually cleared.";
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  return `Instagram asked us to wait ${m}:${String(s).padStart(2, "0")} more.`;
}

export type FailureStripActionKind = "retry_all" | "retry_gaps" | "settings" | "copy_command" | "none";

export interface FailureStripAction {
  kind: FailureStripActionKind;
  label: string;
  disabled: boolean;
}

/**
 * One action per kind, per the brief: every failure strip carries the one thing Kai can
 * actually do about it. `cooldownRemaining` only matters for `cooldown` — passed in
 * rather than recomputed here so the component's one ticking clock is the only place
 * that reads `Date.now()`.
 */
export function failureStripAction(strip: FailureStrip, cooldownRemaining: number | null): FailureStripAction {
  switch (strip.kind) {
    case "service_down":
      return { kind: "copy_command", label: "Copy start command", disabled: false };
    case "session_expired":
      return { kind: "settings", label: "Reconnect in Settings", disabled: false };
    case "cooldown":
      return {
        kind: "retry_all",
        label: cooldownRemaining !== null && cooldownRemaining > 0 ? "Waiting on the cooldown" : "Try again",
        disabled: cooldownRemaining !== null && cooldownRemaining > 0,
      };
    case "offline":
      return { kind: "retry_all", label: "Try again", disabled: false };
    case "partial":
      return strip.gaps.length > 0
        ? { kind: "retry_gaps", label: `Retry ${strip.gaps.length} channel${strip.gaps.length === 1 ? "" : "s"}`, disabled: false }
        : { kind: "retry_all", label: "Sync again", disabled: false };
    case "failed":
      return strip.gaps.length > 0
        ? { kind: "retry_gaps", label: `Retry ${strip.gaps.length} channel${strip.gaps.length === 1 ? "" : "s"}`, disabled: false }
        : { kind: "retry_all", label: "Retry", disabled: false };
    case "none":
    case "running":
      return { kind: "none", label: "", disabled: true };
  }
}

/** The small mono facts row: the code(s) that decided the kind, Instagram's own message
 *  if it gave one, and what survived. Never fabricates a field that came back null —
 *  each piece is dropped rather than rendered empty. */
export function failureStripFacts(strip: FailureStrip): string {
  // `partial` already says what survived in its own sentence, so repeating the counts
  // here printed the same line twice, once inside the headline and once under it.
  // Every other kind leads with what broke rather than what was kept, so the counts
  // still belong in this row for them.
  const kept = strip.kind === "partial" ? null : formatKeptCounts(strip.kept);
  const parts = [strip.errorCode, strip.errorMessage, kept].filter(
    (v): v is string => v !== null && v.length > 0,
  );
  return parts.join(" · ");
}

export interface FailureStripCopy {
  title: string;
  tone: FailureStripTone;
  headline: string;
  facts: string;
}

/** Null for `none`/`running` — the one check a caller needs to decide whether to render
 *  anything at all. */
export function failureStripCopy(strip: FailureStrip): FailureStripCopy | null {
  const tone = failureStripTone(strip.kind);
  if (tone === null) return null;
  return {
    title: failureStripTitle(strip.kind),
    tone,
    headline: failureStripHeadline(strip),
    facts: failureStripFacts(strip),
  };
}

/** Re-exported so the strip and the gap detail list it discloses use the exact same
 *  channel naming and per-gap wording as the live sync panel, rather than a second copy
 *  that could drift from it. */
export { gapDisplayName, gapMessage } from "./sync-progress-view";
export type { FailureStripGap };
