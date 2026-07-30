"use client";

/**
 * "Choose who to watch" — docs/product/v1-scope.md §2 AC 9–10. The prototype's version
 * of this screen toggles a pre-populated list of suggested channels on and off. This app
 * has no such list to suggest — inventing one would be exactly the fabricated data the
 * truth pass exists to remove — so this is a handle-in, handle-out list instead: type a
 * handle, add it to the pending list, remove one you didn't mean to add, then Continue
 * commits the whole list. Nothing is a `channels` row until Continue is pressed (AC 10),
 * built on the same `addChannelAction` the Channels page's own add-channel dialog uses.
 *
 * `addChannelAction` is idempotent for a handle that already exists (it short-circuits to
 * the existing row rather than erroring — see `bridgeAddChannel`'s own comment), so
 * re-pressing Continue after a partial failure is always safe: the handles that already
 * succeeded do not get a duplicate or an error the second time.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addChannelAction } from "@/server/actions/sync-actions";

export interface SourcesStepProps {
  onBack: () => void;
  onContinue: (channelIds: string[]) => void;
}

function normalizeForDedupe(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function SourcesStep({ onBack, onContinue }: SourcesStepProps) {
  const [handles, setHandles] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState<{ handle: string; error: string }[]>([]);
  const [pending, setPending] = useState(false);

  function addHandle() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const key = normalizeForDedupe(trimmed);
    if (handles.some((h) => normalizeForDedupe(h) === key)) {
      setDraft("");
      return;
    }
    setHandles((prev) => [...prev, trimmed]);
    setDraft("");
    setFailed((prev) => prev.filter((f) => normalizeForDedupe(f.handle) !== key));
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
    onContinue(ids);
  }

  const canContinue = handles.length > 0 && !pending;

  return (
    <div>
      <span className="font-mono text-2xs tracking-wide text-faint">03 · CHANNELS</span>
      <h1 className="mt-4 text-xl leading-tight font-bold tracking-tight">Choose who to watch</h1>
      <p className="mt-5 max-w-[48ch] text-sm leading-relaxed text-muted-foreground text-balance">
        Add the Instagram handles you compete with. You can add more later from Channels.
      </p>

      <div className="mt-11 flex max-w-[460px] items-center gap-2">
        <Input
          placeholder="@handle"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addHandle();
          }}
          aria-label="Instagram handle"
        />
        <Button variant="outline" size="sm" onClick={addHandle} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

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
          {handles.length === 0 ? "Add at least one channel to continue" : `${handles.length} selected`}
        </span>
      </div>
      <p className="mt-10 font-mono text-2xs tracking-wide text-faint">More can be added later from Channels.</p>
    </div>
  );
}
