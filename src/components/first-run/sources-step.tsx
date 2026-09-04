"use client";

/**
 * "Choose who to watch" — docs/product/v1-scope.md §2 AC 9–10. The prototype's version
 * of this screen toggles a pre-populated list of suggested channels on and off. This app
 * has no such list to suggest — no search endpoint, no recommendation service, and
 * inventing one would be exactly the fabricated data the truth pass exists to remove —
 * so this is a handle-in, handle-out list instead: type or paste a handle (or several at
 * once), add them to the pending list, remove one you didn't mean to add, then Continue
 * commits the whole list. Nothing is a `channels` row until Continue is pressed (AC 10),
 * built on the same `addChannelAction` the Channels page's own add-channel dialog uses.
 *
 * `addChannelAction` is idempotent for a handle that already exists (it short-circuits to
 * the existing row rather than erroring — see `bridgeAddChannel`'s own comment), so
 * re-pressing Continue after a partial failure is always safe: the handles that already
 * succeeded do not get a duplicate or an error the second time.
 *
 * Two honest concessions to "no suggestion service exists," both about what this screen
 * can and can't confirm for you:
 *
 *  - `niche` (threaded down from the focus step via `onboarding-flow.tsx`) is echoed back
 *    in the copy below, so the personalization the focus step promises visibly lands
 *    somewhere instead of going nowhere. It does not filter or pre-fill anything — there
 *    is nothing to filter a suggestion list from — it just proves the answer was heard.
 *  - `canVerifyHandles` (derived from live Instagram status, not the page-load snapshot —
 *    see `onboarding-flow.tsx`'s `onContinue` on the connect step) governs the copy under
 *    the input, not what happens on Continue: `addChannelAction` behaves identically
 *    either way. When it's `false`, the sidecar can't be asked whether a handle is real
 *    (`/profile` needs a logged-in session — `services/ig/crowsnest_ig/session.py`'s
 *    `require_login`), so `addChannel` catches that failure and still inserts a thin
 *    channel row with `syncError` set rather than rejecting the handle — the malformed-
 *    format check (`normalizeHandle`) is the only thing that can bounce a handle here.
 *    Saying that plainly beats leaving the box looking like it verified something it
 *    didn't.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SeedPicker } from "@/components/discover/seed-picker";
import { addChannelAction } from "@/server/actions/sync-actions";
import type { CreatorSeedRow } from "@/server/queries/discover";

export interface SourcesStepProps {
  /** What the focus step's answer was — see the module doc above for why this screen
   *  echoes it rather than acting on it. */
  niche: string;
  /** Curated creator seeds for the drop-in picker. The "list to suggest" the module doc
   *  above says this app used to lack — following one adds and syncs it immediately. */
  seeds: CreatorSeedRow[];
  /** Whether the sidecar can currently look a handle up on Instagram. Copy-only; see
   *  module doc. */
  canVerifyHandles: boolean;
  onBack: () => void;
  onContinue: (channelIds: string[]) => void;
}

function normalizeForDedupe(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function SourcesStep({ niche, seeds, canVerifyHandles, onBack, onContinue }: SourcesStepProps) {
  const [handles, setHandles] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState<{ handle: string; error: string }[]>([]);
  const [pending, setPending] = useState(false);
  // Channels the SeedPicker already followed (added + synced) this mount. Unlike the
  // manual list, these are live `channels` rows the moment Follow is pressed, so they are
  // carried through Continue rather than re-added.
  const [seedChannelIds, setSeedChannelIds] = useState<string[]>([]);

  function onSeedsFollowed(ids: string[]) {
    setSeedChannelIds((prev) => Array.from(new Set([...prev, ...ids])));
  }

  /**
   * One handle typed and Enter-pressed is the common case, but the box also accepts a
   * paste of several at once (comma-, space-, or newline-separated) — competitors rarely
   * come one at a time, and re-typing "Add" per handle when you already have a list in
   * hand is exactly the kind of friction this step shouldn't add on top of "no
   * suggestions exist." Whatever's already in the pending list, or repeated within the
   * same paste, is silently deduped rather than rejected.
   */
  function addHandles() {
    const tokens = draft
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;

    setHandles((prev) => {
      const seen = new Set(prev.map(normalizeForDedupe));
      const next = [...prev];
      for (const token of tokens) {
        const key = normalizeForDedupe(token);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(token);
      }
      return next;
    });
    setDraft("");
    const addedKeys = new Set(tokens.map(normalizeForDedupe));
    setFailed((prev) => prev.filter((f) => !addedKeys.has(normalizeForDedupe(f.handle))));
  }

  function removeHandle(handle: string) {
    setHandles((prev) => prev.filter((h) => h !== handle));
    setFailed((prev) => prev.filter((f) => f.handle !== handle));
  }

  async function handleContinue() {
    setPending(true);
    setFailed([]);
    const ids: string[] = [];
    const failures: { handle: string; error: string }[] = [];
    for (const handle of handles) {
      const result = await addChannelAction(handle);
      if (result.ok) ids.push(result.channelId);
      else failures.push({ handle, error: result.error });
    }
    setPending(false);
    if (failures.length > 0) {
      setFailed(failures);
      return;
    }
    // Seed-followed channels are already live rows; carry them through with the manual
    // adds, deduped in case a handle was both followed here and typed by hand.
    onContinue(Array.from(new Set([...seedChannelIds, ...ids])));
  }

  const totalSelected = handles.length + seedChannelIds.length;
  // Following curated creators alone is enough to continue — a manual handle is no longer
  // required now that the picker supplies real, already-tracked channels.
  const canContinue = totalSelected > 0 && !pending;

  return (
    <div>
      <span className="font-mono text-2xs tracking-wide text-faint">03 · CHANNELS</span>
      <h1 className="mt-4 text-xl leading-tight font-bold tracking-tight">Choose who to watch</h1>
      <p className="mt-5 max-w-[48ch] text-sm leading-relaxed text-muted-foreground text-balance">
        Add the Instagram handles you compete with. You can add more later from Channels.
      </p>
      <p className="mt-2 max-w-[48ch] text-xs text-muted-foreground">
        Based on what you told us you make: <span className="text-foreground">{niche}</span>
      </p>

      {seeds.length > 0 && (
        <section className="mt-10 max-w-[560px]" data-testid="first-run-seed-picker">
          <span className="font-mono text-2xs tracking-wide text-faint">SUGGESTED CREATORS</span>
          <p className="mt-3 mb-4 text-sm text-muted-foreground">
            Curated accounts worth watching. Follow up to 10 to start tracking them now, or add
            your own handles below.
          </p>
          <SeedPicker seeds={seeds} maxSelect={10} onDone={onSeedsFollowed} />
        </section>
      )}

      <span className="mt-11 block font-mono text-2xs tracking-wide text-faint">
        {seeds.length > 0 ? "OR ADD YOUR OWN" : ""}
      </span>
      <div className="mt-3 flex max-w-[460px] items-center gap-2">
        <Input
          placeholder="@handle, or paste several separated by commas"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addHandles();
          }}
          aria-label="Instagram handles"
        />
        <Button variant="outline" size="sm" onClick={addHandles} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      <p className="mt-2 max-w-[460px] text-xs text-muted-foreground">
        {canVerifyHandles
          ? "Checked against Instagram when you press Continue — a real handle's name and follower count show up on the Channels page right after; one that doesn't exist shows up there as \"Sync failed\" instead."
          : "Instagram isn't connected right now, so only the handle's format gets checked here — whether the account actually exists is sorted out once you connect and sync."}
      </p>

      {handles.length > 0 && (
        <ul className="mt-6 flex max-w-[460px] flex-col">
          {handles.map((handle) => {
            const failure = failed.find((f) => f.handle === handle);
            return (
              <li key={handle} className="flex items-center justify-between gap-3 border-b border-border py-3">
                <div className="min-w-0">
                  <span className="text-base whitespace-nowrap text-foreground">{handle}</span>
                  {failure && <p className="mt-1 text-xs text-destructive">{failure.error}</p>}
                </div>
                <Button size="icon-xs" variant="ghost" aria-label={`Remove ${handle}`} onClick={() => removeHandle(handle)}>
                  ×
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-7">
        <Button variant="outline" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={() => void handleContinue()} disabled={!canContinue}>
          {pending ? "Adding…" : "Continue"}
        </Button>
        <span className="font-mono text-xs text-faint">
          {totalSelected === 0 ? "Follow or add at least one channel to continue" : `${totalSelected} selected`}
        </span>
      </div>
      <p className="mt-10 font-mono text-2xs tracking-wide text-faint">More can be added later from Channels.</p>
    </div>
  );
}
