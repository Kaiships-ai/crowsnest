"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Rows3, Search, X } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { FeedBandCounts, SavedFilterRow } from "@/server/queries/feed";

type Fleet = { id: string; name: string; channelCount: number };

// Debounce on the search box only — every other control here is a discrete menu pick
// that should navigate the instant it's chosen. Free text needs the opposite: firing a
// router.replace per keystroke would thrash the URL and refetch the feed mid-word.
const SEARCH_DEBOUNCE_MS = 350;

// Instagram only in V1 (V1-BRIEF.md, Kai's ruling 2026-07-31) — TikTok and YT
// Shorts pulled out. Sync can only ever write platform: "instagram", so those two
// options returned zero rows every time, by construction.
const PLATFORM_OPTIONS = [
  { value: "all", label: "All" },
  { value: "instagram", label: "IG" },
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
  // The "High Conviction" saved preset (server/db/bootstrap.ts) sets sinceDays:14, which
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

// Every param a filter control can write — used to detect "any filter touched" for
// the Clear-filters affordance and to wipe them all in one shot.
const FILTER_PARAM_KEYS = ["fleet", "platform", "minScore", "minViews", "since", "band", "q"] as const;

// Filters read as current state, not a form to fill in (brief): plain text with a
// chevron, no input-style border, until opened or hovered. Matches the prototype's
// filterBtn treatment (feed.html line 17: color var(--t3), hover bg var(--s1) color
// var(--t1)) — dark: overrides neutralize the shadcn Select's own default input chrome.
const FILTER_TRIGGER_CLASS =
  "h-7 gap-1.5 rounded-none border-transparent bg-transparent px-2 text-sm text-muted-foreground hover:bg-card hover:text-foreground aria-expanded:bg-card aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-card";

export function FilterBar({
  fleets,
  savedFilters,
  bandCounts,
}: {
  fleets: Fleet[];
  savedFilters: SavedFilterRow[];
  /** Real counts per follower band under every other active filter (v1-scope.md Feed
   *  AC 6) — computed server-side by getFeedBandCounts, never re-derived client-side. */
  bandCounts: FeedBandCounts;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlQuery = searchParams.get("q") ?? "";
  // Local echo of the search box so typing feels instant; the URL (and therefore the
  // feed refetch) only updates after SEARCH_DEBOUNCE_MS of no further keystrokes.
  const [queryDraft, setQueryDraft] = useState(urlQuery);
  // "Adjusting state when a prop changes" (react.dev) rather than an effect: when the
  // URL's `q` moves for a reason outside this box — Clear filters, browser back/forward
  // — the draft snaps to match, without fighting the debounce timer below. Tracking the
  // last-seen URL value lets this run during render instead of after a commit.
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery);
    setQueryDraft(urlQuery);
  }

  useEffect(() => {
    if (queryDraft === urlQuery) return;
    // A dedicated setter, not the generic `set` below: that one treats the literal
    // string "any" as "clear this param" (its sentinel for every Select's placeholder
    // option), which would wrongly wipe out a search for the word "any" itself.
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = queryDraft.trim();
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
      params.delete("limit");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft]);

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

  function clearFilters() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_PARAM_KEYS) params.delete(key);
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
  const hasActiveFilters = FILTER_PARAM_KEYS.some((key) => searchParams.has(key));

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
      {/* Free-text search (v1-scope.md P0: "a conspicuous hole in a research tool").
          Underline field, not a boxed input — matches the filter row's read-as-state
          treatment rather than looking like a form. Searches caption, handle, and
          display name server-side (queries/feed.ts). */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
        <Input
          type="search"
          value={queryDraft}
          onChange={(e) => setQueryDraft(e.target.value)}
          placeholder="Search captions and channels"
          aria-label="Search captions and channels"
          className="h-8 rounded-none border-0 border-b border-border bg-transparent pl-5 focus-visible:border-b-ring focus-visible:ring-0"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Select items={fleetItems} value={fleet} onValueChange={(v) => set("fleet", v as string)}>
          <SelectTrigger size="sm" aria-label="Fleet" className={FILTER_TRIGGER_CLASS}>
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
          <SelectTrigger size="sm" aria-label="Minimum outlier score" className={FILTER_TRIGGER_CLASS}>
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
          <SelectTrigger size="sm" aria-label="Minimum views" className={FILTER_TRIGGER_CLASS}>
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
          <SelectTrigger size="sm" aria-label="Timeframe" className={FILTER_TRIGGER_CLASS}>
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

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" className={cn(FILTER_TRIGGER_CLASS, "rounded-full")} />}
          >
            Saved views
          </DropdownMenuTrigger>
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

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="rounded-full text-muted-foreground hover:text-foreground"
          >
            <X /> Clear filters
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Select items={SORT_OPTIONS} value={sort} onValueChange={(v) => set("sort", v as string)}>
            <SelectTrigger size="sm" aria-label="Sort" className={FILTER_TRIGGER_CLASS}>
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

      {/* Follower band stays a first-class visible control, never tucked in a menu
          (brief) — a persistent segmented row, not a Select. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs text-faint" data-lab="1">
          Followers
        </span>
        <ToggleGroup
          value={[band]}
          onValueChange={(vals) => set("band", (vals[0] as string | undefined) ?? "any")}
          aria-label="Follower band"
        >
          {BAND_OPTIONS.map((o) => (
            <ToggleGroupItem key={o.value} value={o.value} size="sm">
              <span>{o.label}</span>
              {/* "Any followers" is the clear-the-filter control, not a fifth band, so it
                  carries no count of its own — real counts (v1-scope.md Feed AC 6) sit on
                  the four bands whose sum they describe. A null-follower channel counts
                  under none of them (getFeedBandCounts), which is why that sum can land
                  under the feed's own total and is still correct. */}
              {o.value !== "any" && (
                <span className="ml-1.5 font-mono text-2xs tabular-nums text-faint" data-num="1">
                  {bandCounts[o.value as keyof FeedBandCounts]}
                </span>
              )}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
