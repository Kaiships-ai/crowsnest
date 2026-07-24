"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Rows3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SavedFilterRow } from "@/server/queries/feed";

type Fleet = { id: string; name: string; channelCount: number };

const PLATFORM_OPTIONS = [
  { value: "all", label: "All" },
  { value: "instagram", label: "IG" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube_shorts", label: "YT Shorts" },
];
const SCORE_OPTIONS = [
  { value: "any", label: "Any score" },
  { value: "2", label: "2×+" },
  { value: "5", label: "5×+" },
  { value: "10", label: "10×+" },
  { value: "20", label: "20×+" },
];
const VIEWS_OPTIONS = [
  { value: "any", label: "Any views" },
  { value: "10000", label: "10K+ views" },
  { value: "100000", label: "100K+ views" },
  { value: "500000", label: "500K+ views" },
  { value: "1000000", label: "1M+ views" },
];
const SINCE_OPTIONS = [
  { value: "7", label: "Last 7d" },
  // The "High Conviction" saved preset (server/db/seed.ts) sets sinceDays:14, which
  // had no matching option here — the Select rendered the bare unlabeled value "14"
  // instead of a proper label once that preset was applied (QA sweep finding, phase 4
  // Task 4). Filtering itself was never wrong, only the displayed label.
  { value: "14", label: "Last 14d" },
  { value: "30", label: "Last 30d" },
  { value: "60", label: "Last 60d" },
  { value: "90", label: "Last 90d" },
];
const BAND_OPTIONS = [
  { value: "any", label: "Any followers" },
  { value: "nano", label: "Nano <10K" },
  { value: "micro", label: "Micro 10K–100K" },
  { value: "mid", label: "Mid 100K–1M" },
  { value: "macro", label: "Macro 1M+" },
];
const SORT_OPTIONS = [
  { value: "score", label: "Highest score" },
  { value: "recent", label: "Most recent" },
  { value: "views", label: "Most views" },
];

// Params a saved preset can set — kept in sync with FeedFilters' criteria-bearing keys.
const PRESET_CRITERIA_KEYS = ["minScore", "minViews", "sinceDays"] as const;
const CRITERIA_TO_PARAM: Record<(typeof PRESET_CRITERIA_KEYS)[number], string> = {
  minScore: "minScore",
  minViews: "minViews",
  sinceDays: "since",
};

export function FilterBar({ fleets, savedFilters }: { fleets: Fleet[]; savedFilters: SavedFilterRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function set(key: string, value: string, resetLimit = true) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all" || value === "any") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    if (resetLimit) params.delete("limit");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function applyPreset(preset: SavedFilterRow) {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of PRESET_CRITERIA_KEYS) {
      const paramName = CRITERIA_TO_PARAM[key];
      const value = preset.criteria[key];
      if (typeof value === "number") {
        params.set(paramName, String(value));
      } else {
        params.delete(paramName);
      }
    }
    params.delete("limit");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const fleet = searchParams.get("fleet") ?? "all";
  const platform = searchParams.get("platform") ?? "all";
  const minScore = searchParams.get("minScore") ?? "any";
  const minViews = searchParams.get("minViews") ?? "any";
  const since = searchParams.get("since") ?? "30";
  const band = searchParams.get("band") ?? "any";
  const sort = searchParams.get("sort") ?? "score";
  const view = searchParams.get("view") ?? "grid";

  const fleetItems = [{ value: "all", label: "All channels" }, ...fleets.map((f) => ({ value: f.id, label: f.name }))];

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
      <Select items={fleetItems} value={fleet} onValueChange={(v) => set("fleet", v as string)}>
        <SelectTrigger size="sm" aria-label="Fleet">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fleetItems.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ToggleGroup
        value={[platform]}
        onValueChange={(vals) => set("platform", (vals[0] as string | undefined) ?? "all")}
        aria-label="Platform"
      >
        {PLATFORM_OPTIONS.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} size="sm">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Select items={SCORE_OPTIONS} value={minScore} onValueChange={(v) => set("minScore", v as string)}>
        <SelectTrigger size="sm" aria-label="Minimum outlier score">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCORE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select items={VIEWS_OPTIONS} value={minViews} onValueChange={(v) => set("minViews", v as string)}>
        <SelectTrigger size="sm" aria-label="Minimum views">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VIEWS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select items={SINCE_OPTIONS} value={since} onValueChange={(v) => set("since", v as string)}>
        <SelectTrigger size="sm" aria-label="Timeframe">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SINCE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select items={BAND_OPTIONS} value={band} onValueChange={(v) => set("band", v as string)}>
        <SelectTrigger size="sm" aria-label="Follower band">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BAND_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>Saved views</DropdownMenuTrigger>
        <DropdownMenuContent>
          {/* Base UI's Menu.GroupLabel (DropdownMenuLabel) throws "MenuGroupContext is
              missing" unless it's inside a Menu.Group (DropdownMenuGroup) — this crashed
              the whole Feed page the instant "Saved views" was opened (QA sweep finding,
              phase 4 Task 4). Radix's equivalent doesn't enforce this, which is exactly
              the "Base UI not Radix" trap the project's own backlog flagged. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Saved views</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {savedFilters.length === 0 && (
              <div className="px-1.5 py-1 text-sm text-muted-foreground">No saved views yet</div>
            )}
            {savedFilters.map((f) => (
              <DropdownMenuItem key={f.id} onClick={() => applyPreset(f)}>
                {f.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-2">
        <Select items={SORT_OPTIONS} value={sort} onValueChange={(v) => set("sort", v as string)}>
          <SelectTrigger size="sm" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ToggleGroup
          value={[view]}
          onValueChange={(vals) => set("view", (vals[0] as string | undefined) ?? "grid", false)}
          aria-label="Layout"
        >
          <ToggleGroupItem value="grid" size="sm" aria-label="Grid view">
            <LayoutGrid className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" size="sm" aria-label="List view">
            <Rows3 className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}
