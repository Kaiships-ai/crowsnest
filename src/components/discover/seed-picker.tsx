"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { followCreatorAction } from "@/server/actions/discover-actions";
import type { CreatorSeedRow } from "@/server/queries/discover";

const NICHES = ["all", "fitness", "finance", "tech", "business"] as const;
type Niche = (typeof NICHES)[number];

const DEFAULT_MAX_SELECT = 10;

/**
 * Drop-in creator seed picker for the first-run "sources" step. Self-contained:
 * no router, no first-run imports — only the shared `CreatorSeedRow` type and
 * `followCreatorAction`. Goal 1 mounts this directly.
 */
export function SeedPicker({
  seeds,
  onDone,
  maxSelect = DEFAULT_MAX_SELECT,
}: {
  seeds: CreatorSeedRow[];
  onDone?: (channelIds: string[]) => void;
  maxSelect?: number;
}) {
  const [niche, setNiche] = useState<Niche>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  // Handles that succeeded in a batch follow this mount. `selected` is cleared
  // right after the batch, so without this a followed row would just go back
  // to enabled/unchecked with no feedback that it worked.
  const [justFollowed, setJustFollowed] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => (niche === "all" ? seeds : seeds.filter((s) => s.niche === niche)),
    [seeds, niche]
  );

  const atCap = selected.size >= maxSelect;

  function toggle(handle: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        // Enforce the cap on selection itself, not just at follow time.
        if (next.size >= maxSelect) return prev;
        next.add(handle);
      } else {
        next.delete(handle);
      }
      return next;
    });
  }

  async function onFollowSelected() {
    // Never follow more than maxSelect, even defensively — selection is already
    // capped, this just guards the batch itself.
    const handles = Array.from(selected).slice(0, maxSelect);
    setPending(true);
    const channelIds: string[] = [];
    const followedNow: string[] = [];
    for (const handle of handles) {
      const result = await followCreatorAction(handle);
      if (result.ok) {
        channelIds.push(result.channelId);
        followedNow.push(handle);
      }
    }
    setPending(false);
    setSelected(new Set());
    setJustFollowed((prev) => {
      const next = new Set(prev);
      for (const handle of followedNow) next.add(handle);
      return next;
    });
    onDone?.(channelIds);
  }

  if (seeds.length === 0) {
    return <p className="text-sm text-muted-foreground">No creators to discover yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={niche} onValueChange={(v) => setNiche(v as Niche)}>
        <TabsList data-testid="seed-picker-niche-filter">
          {NICHES.map((n) => (
            <TabsTrigger key={n} value={n} className="font-mono uppercase tracking-wide">
              {n}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <p className="text-xs text-muted-foreground" data-testid="seed-picker-max-hint">
        Select up to {maxSelect} at a time.
      </p>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No creators in this niche.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((seed) => {
            const isTracked = seed.tracked || justFollowed.has(seed.handle);
            const isSelected = selected.has(seed.handle);
            const disabled = isTracked || (!isSelected && atCap);
            return (
              <li
                key={seed.handle}
                data-testid="seed-picker-row"
                className="flex items-center gap-3 border border-border bg-card px-3 py-2"
              >
                <Checkbox
                  data-testid={`seed-picker-checkbox-${seed.handle}`}
                  aria-label={`Select @${seed.handle}`}
                  checked={isSelected}
                  disabled={disabled}
                  onCheckedChange={(v) => toggle(seed.handle, v === true)}
                />
                <span className="truncate font-mono text-sm text-foreground">@{seed.handle}</span>
                <Badge variant="secondary" className="shrink-0 font-mono text-2xs uppercase tracking-wide">
                  {seed.niche}
                </Badge>
                <span className="truncate text-xs text-muted-foreground">{seed.why}</span>
                {isTracked && (
                  <Badge variant="outline" className="ml-auto shrink-0 text-2xs uppercase tracking-wide">
                    Tracked
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        data-testid="seed-picker-follow-selected"
        disabled={selected.size === 0 || pending}
        onClick={() => void onFollowSelected()}
        className="self-start"
      >
        {pending ? "Following…" : `Follow selected (${selected.size})`}
      </Button>
    </div>
  );
}
