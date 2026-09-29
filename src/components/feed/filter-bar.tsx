"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Grid2x2, Grid3x3, LayoutGrid, Plus, Rows3, Search, Settings2, X } from "lucide-react";

import { AddChannelDialog } from "@/components/channels/add-channel-dialog";
import { ManageSavedViewsDialog } from "@/components/feed/manage-saved-views-dialog";
import { Badge } from "@/components/ui/badge";
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { currentViewCriteria as buildViewCriteria, FILTER_PARAM_KEYS, resolveChipValue } from "@/lib/feed-filters";
import type { FeedBandCounts, SavedFilterRow } from "@/server/queries/feed";

type Fleet = { id: string; name: string; channelCount: number };

// Debounce on the search box only — every other control here is a discrete menu pick
// that should navigate the instant it's chosen. Free text needs the opposite: firing a
// router.replace per keystroke would thrash the URL and refetch the feed mid-word.
const SEARCH_DEBOUNCE_MS = 350;

// No platform control at all. V1 is Instagram only (V1-BRIEF.md, Kai's ruling
// 2026-07-31), so TikTok and YT Shorts came out first, and the All/IG toggle that
// survived that pass was just as empty: both options return the same rows, because
// sync can only ever write platform: "instagram". A control whose two settings are
// indistinguishable is the same defect as one that does nothing.
// The `platform` URL param and the schema column both stay, so a second platform
// later is additive rather than a migration.
// Label copy only — the units now read the same way across all three thresholds
// (value + noun, e.g. "500K+ views"), where score and engagement used to drop the
// noun ("10x+", "5%+") while views kept it. Values and URL param encoding are
// untouched; this is a display-string change only (task-2 brief, board finding
// "mixed label syntax").
const SCORE_OPTIONS = [
  { value: "any", label: "Any score" },
  { value: "2", label: "2×+ score" },
  { value: "5", label: "5×+ score" },
  { value: "10", label: "10×+ score" },
  { value: "20", label: "20×+ score" },
];
const VIEWS_OPTIONS = [
  { value: "any", label: "Any views" },
  { value: "10000", label: "10K+ views" },
  { value: "100000", label: "100K+ views" },
  { value: "500000", label: "500K+ views" },
  { value: "1000000", label: "1M+ views" },
];
const ENGAGEMENT_OPTIONS = [
  { value: "any", label: "Any engagement" },
  { value: "2", label: "2%+ engagement" },
  { value: "5", label: "5%+ engagement" },
  { value: "8", label: "8%+ engagement" },
];
// Not a Select: Analyzed/Unanalyzed is its own persistent two-state row (task-4 brief),
// the same "first-class control, not a menu" treatment the follower band row already
// gets below. Its on-state is ToggleGroup's own selected tone, not the score's signal
// color, because this is a plain on/off filter state and not a measure of how hard a
// post beat its channel.
const ANALYZED_OPTIONS = [
  { value: "yes", label: "Analyzed" },
  { value: "no", label: "Unanalyzed" },
];
const SINCE_OPTIONS = [
  { value: "any", label: "Any timeframe" },
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

// Selects whose "any"/clear option must persist as an explicit `key=any` URL token
// rather than deleting the key (fix 1b) — score, views, timeframe, follower band, and
// engagement. Fleet's "all channels" placeholder is deliberately not in this set (see
// `set` below).
const ANY_WRITES_PARAM = new Set(["minScore", "minViews", "since", "band", "minEng"]);

// Filters read as current state, not a form to fill in (brief): plain text with a
// chevron, no input-style border, until opened or hovered. Matches the prototype's
// filterBtn treatment (feed.html line 17: color var(--t3), hover bg var(--s1) color
// var(--t1)) — dark: overrides neutralize the shadcn Select's own default input chrome.
const FILTER_TRIGGER_CLASS =
  "h-7 gap-1.5 rounded-full border-transparent bg-transparent px-2 text-sm text-muted-foreground hover:bg-card hover:text-foreground aria-expanded:bg-card aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-card";

// Same read-as-state treatment as FILTER_TRIGGER_CLASS, sized down (task-2 brief: score,
// timeframe, and follower-band lead; fleet/min-views/min-engagement/analyzed recede by
// weight only — smaller and more muted, never hidden behind a popover or menu).
const SECONDARY_FILTER_TRIGGER_CLASS =
  "h-6 gap-1 rounded-full border-transparent bg-transparent px-1.5 text-xs text-muted-foreground hover:bg-card hover:text-muted-foreground aria-expanded:bg-card aria-expanded:text-muted-foreground dark:bg-transparent dark:hover:bg-card";

/** Chip text for the active-filter summary: reuses the option's own (already-normalized)
 *  label rather than inventing separate copy, so the chip always matches what the
 *  control itself displays. */
function chipLabel(options: { value: string; label: string }[], value: string): string | undefined {
  return options.find((o) => o.value === value)?.label;
}

export function FilterBar({
  fleets,
  savedFilters,
  bandCounts,
  applied,
}: {
  fleets: Fleet[];
  savedFilters: SavedFilterRow[];
  /** Real counts per follower band under every other active filter (v1-scope.md Feed
   *  AC 6) — computed server-side by getFeedBandCounts, never re-derived client-side. */
  bandCounts: FeedBandCounts;
  /** What the page actually filtered by, which is not always what the URL says. A bare
   *  /feed visit applies the "Balanced" preset server-side, so reading the URL alone
   *  showed "Any score" while a minimum of 5 was hiding most of the library. The
   *  controls read this instead, so the row always states the filter that ran. */
  applied: { minScore: number | null; minViews: number | null; sinceDays: number | null };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [manageViewsOpen, setManageViewsOpen] = useState(false);
  const [addVideoOpen, setAddVideoOpen] = useState(false);

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
    if (value === "all") {
      // Fleet's placeholder ("All channels") has no explicit-vs-absent distinction to
      // preserve — there's no saved "Balanced fleet" default it could stomp on — so it
      // stays a plain delete.
      params.delete(key);
    } else if (value === "any" && ANY_WRITES_PARAM.has(key)) {
      // Score/views/timeframe/band need "any" to survive as a real URL token, not a
      // deletion: from a bare /feed, deleting an already-absent param leaves the query
      // string empty, which reads as a fresh bare visit and makes the "Balanced" preset
      // reapply right back (finding 2, docs/qa/2026-08-01-feed-fix-plan.md). Writing
      // `key=any` makes "explicitly no condition" distinguishable from "never touched".
      params.set(key, value);
    } else {
      // (M1, branch review) There used to be a third branch here deleting the param for
      // a bare `value === "any"` outside ANY_WRITES_PARAM. It was unreachable — every
      // caller that can pass "any" (the four selects above) uses a key in
      // ANY_WRITES_PARAM, and fleet/sort/view/density never produce the string "any" —
      // so it's folded into this branch. If a future select adds an "any" sentinel
      // outside that set, decide explicitly whether it should delete or persist the
      // param instead of relying on this fallthrough.
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
        // (I2, branch review) A key the preset doesn't constrain writes `key=any`, not a
        // delete: deleting every criteria key an "everything" preset omits can collapse
        // the URL to a bare /feed (if nothing else is in the query string), which
        // reapplies "Balanced" right back instead of the "show everything" the user
        // actually saved. Balanced itself now round-trips as
        // ?minScore=5&minViews=any&since=30 rather than a bare URL.
        params.set(paramName, "any");
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
  // Extracted to feed-filters.ts's `resolveChipValue` (I3, branch review) so this
  // applied-vs-URL fallback is unit-tested without mounting the component.
  const minScore = resolveChipValue(searchParams.get("minScore"), applied.minScore);
  const minViews = resolveChipValue(searchParams.get("minViews"), applied.minViews);
  const since = resolveChipValue(searchParams.get("since"), applied.sinceDays);
  // No applied-side fallback for engagement (unlike score/views/timeframe): no saved
  // preset constrains it, so the URL's own token — or "any" absent one — is the whole
  // story.
  const minEng = resolveChipValue(searchParams.get("minEng"), null);
  const analyzed = searchParams.get("analyzed") ?? "all";
  const band = searchParams.get("band") ?? "any";
  const sort = searchParams.get("sort") ?? "score";
  const view = searchParams.get("view") ?? "grid";
  // Comfortable is the implicit default (no param written for it), same convention as
  // `view`'s "grid" — a bare /feed URL stays as short as possible, and only the
  // non-default choice shows up in a saved view's query string.
  const density = searchParams.get("density") === "compact" ? "compact" : "comfortable";

  const fleetItems = [{ value: "all", label: "All channels" }, ...fleets.map((f) => ({ value: f.id, label: f.name }))];
  const hasActiveFilters = FILTER_PARAM_KEYS.some((key) => searchParams.has(key));

  // What "save this as a view" would persist — the same three criteria keys
  // applyPreset reads back, built from the row's own already-resolved state so a save
  // always matches exactly what the filter row is currently showing (URL param, or the
  // applied fallback on a bare visit). All three are omitted rather than saved as "any",
  // the same way a system preset omits a key it doesn't constrain — `since` joined this
  // rule once its fallback stopped hardcoding "30" (finding 3), since `Number("any")` is
  // NaN and would otherwise land in a saved view unconditionally. Extracted to
  // feed-filters.ts's `currentViewCriteria` (I3, branch review) for the same reason as
  // `resolveChipValue` above — aliased on import since this local name shadows it.
  const viewCriteria = buildViewCriteria(minScore, minViews, since);

  // The persistent active-filter summary (task-2 brief, step 3): one chip per applied
  // threshold, built from the same resolved state the controls above already render —
  // never a second source of truth for "what's active". `hasActiveFilters` (the
  // existing FILTER_PARAM_KEYS check) already gates whether this shows at all.
  const activeChips: { key: string; label: string }[] = [];
  if (hasActiveFilters) {
    const push = (key: string, label: string | undefined) => {
      if (label) activeChips.push({ key, label });
    };
    if (fleet !== "all") push("fleet", fleetItems.find((f) => f.value === fleet)?.label);
    if (minScore !== "any") push("minScore", chipLabel(SCORE_OPTIONS, minScore));
    if (minViews !== "any") push("minViews", chipLabel(VIEWS_OPTIONS, minViews));
    if (minEng !== "any") push("minEng", chipLabel(ENGAGEMENT_OPTIONS, minEng));
    if (since !== "any") push("since", chipLabel(SINCE_OPTIONS, since));
    if (band !== "any") push("band", chipLabel(BAND_OPTIONS, band));
    if (analyzed !== "all") push("analyzed", chipLabel(ANALYZED_OPTIONS, analyzed));
    const trimmedQuery = urlQuery.trim();
    if (trimmedQuery) push("q", `“${trimmedQuery}”`);
  }

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
      {/* Free-text search (v1-scope.md P0: "a conspicuous hole in a research tool").
          Searches caption, handle, and display name server-side (queries/feed.ts). */}
      <InputGroup className="w-full sm:w-80">
        <InputGroupAddon align="inline-start">
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={queryDraft}
          onChange={(e) => setQueryDraft(e.target.value)}
          placeholder="Search captions and channels"
          aria-label="Search captions and channels"
        />
      </InputGroup>

      <div className="flex flex-wrap items-center gap-2">
        {/* Filters cluster: score and timeframe lead at full weight (task-2 brief) — they
            drive the core "what over-performed, when" question, alongside the
            follower-band row below. Fleet, min-views, min-engagement, and the analyzed
            toggle recede to smaller, more muted triggers: still fully visible and
            functional, never hidden behind a popover/dropdown/drawer/`<details>`. */}
        <Select items={SCORE_OPTIONS} value={minScore} onValueChange={(v) => set("minScore", v as string)}>
          <SelectTrigger
            size="sm"
            aria-label="Minimum outlier score"
            data-testid="feed-filter-min-score"
            className={FILTER_TRIGGER_CLASS}
          >
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

        <Select items={fleetItems} value={fleet} onValueChange={(v) => set("fleet", v as string)}>
          <SelectTrigger size="sm" aria-label="Fleet" className={SECONDARY_FILTER_TRIGGER_CLASS}>
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

        <Select items={VIEWS_OPTIONS} value={minViews} onValueChange={(v) => set("minViews", v as string)}>
          <SelectTrigger size="sm" aria-label="Minimum views" className={SECONDARY_FILTER_TRIGGER_CLASS}>
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

        <Select items={ENGAGEMENT_OPTIONS} value={minEng} onValueChange={(v) => set("minEng", v as string)}>
          <SelectTrigger size="sm" aria-label="Minimum engagement" className={SECONDARY_FILTER_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENGAGEMENT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Two-state segmented control, not a Select: there's no "any" third state to
            pick from a menu, because the clear action is re-clicking the active one.
            That is exactly what this build's ToggleGroup does with an array value, so
            it converges on the same primitive as the layout, density and follower-band
            rows rather than hand-rolling aria-pressed buttons. An empty array is the
            cleared state, which the URL spells "all". */}
        <ToggleGroup
          value={analyzed === "all" ? [] : [analyzed]}
          onValueChange={(vals: unknown[]) => set("analyzed", (vals[0] as string | undefined) ?? "all")}
          aria-label="Analyzed status"
        >
          {ANALYZED_OPTIONS.map((o) => (
            <ToggleGroupItem key={o.value} value={o.value} size="sm">
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {/* Actions cluster: saving a view, clearing, and importing a URL are actions,
            not filters — separated from the filter group above so the row reads as
            "what I'm filtering by" then "what I can do". */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" className={FILTER_TRIGGER_CLASS} />}
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
              <DropdownMenuSeparator />
              {/* Saving the current filters as a new view is the main path here (brief)
                  — it's the first thing this opens onto, not a buried settings screen.
                  Rename/delete for existing (non-system) views live in the same dialog
                  rather than cluttering this menu with per-row icon buttons. */}
              <DropdownMenuItem onClick={() => setManageViewsOpen(true)}>
                <Settings2 /> Save / manage views…
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Opens the same single-reel import as the Channels board's "Add channel" ->
            "Paste reel URL" tab (add-channel-dialog.tsx) — that dialog is now controllable
            from here (open/onOpenChange/initialTab) rather than this button driving a
            second call to bridgeImportReel itself. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAddVideoOpen(true)}
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          <Plus /> Add post URL
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
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

          {/* A thin divider so the layout toggle and the density toggle read as two
              separate 2-state groups, not one run of four icons where a selected item in
              each looks like two-of-four selected. */}
          <Separator orientation="vertical" className="mx-0.5 h-5" />

          {/* Same kind of control as the grid/list toggle above, so it sits right next
              to it (prototype feed.html line 6: comfortable/compact chips beside the
              grid/list chips). Persists as `?density=compact` in the URL, same
              mechanism as `view`, so a reload or a saved view keeps it. Grid-only in
              effect right now — FeedGrid packs more, smaller columns and switches
              OutlierCard to its existing `variant="compact"` — list view is already a
              dense table and doesn't have a second, denser row style. */}
          <ToggleGroup
            value={[density]}
            onValueChange={(vals) => set("density", (vals[0] as string | undefined) ?? "comfortable", false)}
            aria-label="Card density"
          >
            <ToggleGroupItem value="comfortable" size="sm" aria-label="Comfortable density">
              <Grid2x2 className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="compact" size="sm" aria-label="Compact density">
              <Grid3x3 className="size-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Follower band stays a first-class visible control, never tucked in a menu
          (brief) — a persistent segmented row, not a Select. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs text-muted-foreground" data-lab="1">
          Followers
        </span>
        {/* `flex-wrap` is the one class this group needs: ToggleGroup is `w-fit` and
            single-line by default, so at 375px the last two bands were clipped off the
            right edge with no way to scroll to them. */}
        <ToggleGroup
          value={[band]}
          onValueChange={(vals) => set("band", (vals[0] as string | undefined) ?? "any")}
          aria-label="Follower band"
          className="flex-wrap"
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
                <span className="ml-1.5 font-mono text-2xs tabular-nums text-muted-foreground" data-num="1">
                  {bandCounts[o.value as keyof FeedBandCounts]}
                </span>
              )}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Persistent active-filter summary (task-2 brief, step 3): names every applied
          threshold as a small neutral chip, plus the single Reset that replaces the old
          actions-cluster "Clear filters" button. The chips are outline Badges rather
          than the filled tone, because they restate what is already on, they are not a
          second call to action competing with Reset. Shows whenever `hasActiveFilters`,
          not only in an empty result state, and reuses the same FILTER_PARAM_KEYS check
          those empty states already read. Per-chip remove is intentionally omitted: the
          brief calls it optional and the one-move Reset the required control. */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="feed-active-filter-summary">
          <span className="text-2xs text-muted-foreground">Active filters</span>
          {activeChips.map((chip) => (
            <Badge key={chip.key} variant="outline">
              {chip.label}
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-6 rounded-full px-2 text-2xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" /> Reset
          </Button>
        </div>
      )}

      <ManageSavedViewsDialog
        open={manageViewsOpen}
        onOpenChange={setManageViewsOpen}
        savedFilters={savedFilters}
        currentCriteria={viewCriteria}
      />

      <AddChannelDialog open={addVideoOpen} onOpenChange={setAddVideoOpen} initialTab="url" showTrigger={false} />
    </div>
  );
}
