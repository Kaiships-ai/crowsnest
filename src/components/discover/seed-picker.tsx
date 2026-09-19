"use client";

import { useMemo, useState } from "react";
import { Compass } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
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
    let failed = 0;
    for (const handle of handles) {
      try {
        const result = await followCreatorAction(handle);
        if (result.ok) {
          channelIds.push(result.channelId);
          followedNow.push(handle);
        } else {
          failed += 1;
        }
      } catch {
        // A rejected server action (transport/serialization) must not abort the
        // loop, or setPending(false) never runs and the button sticks on "Following…".
        failed += 1;
      }
    }
    setPending(false);
    setSelected(new Set());
    setJustFollowed((prev) => {
      const next = new Set(prev);
      for (const handle of followedNow) next.add(handle);
      return next;
    });
    if (failed > 0) {
      toast.error(`${failed} of ${handles.length} could not be followed.`);
    }
    // Only advance the caller (e.g. first-run "sources" step) when at least one
    // follow actually landed — never on an all-failed batch with an empty list.
    if (channelIds.length > 0) onDone?.(channelIds);
  }

  if (seeds.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Compass />
          </EmptyMedia>
          <EmptyTitle>No creators to discover yet.</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
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
        <ItemGroup>
          {filtered.map((seed) => {
            const isTracked = seed.tracked || justFollowed.has(seed.handle);
            const isSelected = selected.has(seed.handle);
            const disabled = isTracked || (!isSelected && atCap);
            return (
              <Item key={seed.handle} data-testid="seed-picker-row" variant="outline" size="sm">
                <ItemMedia>
                  <Checkbox
                    data-testid={`seed-picker-checkbox-${seed.handle}`}
                    aria-label={`Select @${seed.handle}`}
                    checked={isSelected}
                    disabled={disabled}
                    onCheckedChange={(v) => toggle(seed.handle, v === true)}
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="w-full truncate font-mono">@{seed.handle}</ItemTitle>
                  <ItemDescription>{seed.why}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge variant="secondary" className="shrink-0 font-mono text-2xs uppercase tracking-wide">
                    {seed.niche}
                  </Badge>
                  {isTracked && (
                    <Badge variant="outline" className="shrink-0 text-2xs uppercase tracking-wide">
                      Tracked
                    </Badge>
                  )}
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
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
