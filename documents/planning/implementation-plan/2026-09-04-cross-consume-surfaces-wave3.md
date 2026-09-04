---
status: active
components: [feed]
backlog: none
owner: Goal 1 lead (opus) - session_01XbUniwFzh3eahwW2AMyvYH
shipped: null
---

# Consume surfaces polish (UI Wave 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ship:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Apply the improvement board's Wave 3 items for the five Consume/Read surfaces: dashboard (`layout`), feed (`distill` + `clarify`), vault (`clarify` + `distill`), video detail (`optimize` in-page Suspense after notFound, `harden`, `polish`), ideas (`onboard` surface the hidden command shortcuts, `polish`). Rendering-layer only, no new dependency, no server/schema/action change.

**Already covered by Wave 1 (do NOT re-add):** `src/app/(shell)/loading.tsx` (generic skeleton for every shell page without its own) and `src/app/(shell)/error.tsx` (error boundary for every shell page) already handle the board's cross-cutting `optimize` (blank-on-load) and `harden` (page-blanking throw) for dashboard/vault/ideas. So this wave does NOT add route loading.tsx or error.tsx for those - the remaining work is the surface-specific items below. Feed has its own `(shell)/feed/(list)/loading.tsx`.

**Constraint carried forward (B-14):** video detail must NOT get a route `loading.tsx` (a loading boundary lets the shell commit a 200 before `notFound()` can set 404). Instead: keep `await getCachedVideoDetail` + `notFound()` FIRST, then wrap the slow parts in an in-page `<Suspense>`.

**Goal 5 coordination:** leave `/feed` and `/ideas` server/data files clean. Do NOT add a discover/suggested-creators surface - Goal 5 wires feed -> idea -> copy-to-LLM later on top of this merged work. This wave only does presentation polish on feed and ideas.

**Spec:** improvement board (`/tmp/crowsnest-goals/improvement-board.txt`, Consume + Read), `DESIGN.md`, `PRODUCT.md`.

## Global Constraints

- **Amber Law:** `--primary` amber only on the score readout and one primary action per screen. Nav/filters/summary chips/hints/skeletons are neutral; errors `--destructive`; positive `--pos`. Per file: `grep -nE "bg-primary|text-primary|border-primary"` and justify each hit.
- **No fabricated data:** never invent a stat delta, a count, or a metric. If a dashboard tile has no real delta, it shows none - even it out by layout, not by inventing a number. Vault empty-state copy must be honest about what does and does not save today.
- **Square corners:** radius tokens are 0; `rounded-*` classes are not bugs.
- **Motion:** CSS only, `motion-reduce` guarded, <=200ms if any is added.
- **Next.js here is not stock:** app opens at `http://localhost:3001` (Goal 1 port). Video-detail B-14 rule above.
- **Before editing any exported symbol:** GitNexus `impact` via MCP (repo "crowsnest", upstream); report callers/risk; warn HIGH/CRITICAL.

---

### Task 1: Dashboard layout - even the stat row and tighten the section voids

Board (dashboard layout): "96px inter-section voids; only one of four stat tiles carries a delta, so the row reads uneven." `src/app/(shell)/page.tsx:143` uses `gap-24` (96px) between every top-level section; the stat grid (`:153`) has 4 `StatTile`s where only the first ("Channels tracked") can render a delta + sparkline, the other three never do, so the row's tiles differ in height/rhythm.

**Files:**
- Modify: `src/app/(shell)/page.tsx` (the root container gap at `:143`, the charts grid gap at `:231-233`)
- Modify: `src/components/dashboard/stat-tile.tsx` (reserve the delta line so tiles align even when no delta)

- [ ] **Step 1: GitNexus impact** (MCP) on the dashboard page function and `StatTile`. Record risk (leaf UI, LOW expected).
- [ ] **Step 2: Tighten the section voids** - in `page.tsx`, reduce the outer `gap-24` to a calmer rhythm (e.g. `gap-16`, or `gap-12` with the charts block keeping a slightly larger gap). Read the current section order first; pick one consistent smaller gap so sections read as one instrument, not floating islands. Do not remove any section. Reduce the charts grid `gap-16` (`:233`) to match the new rhythm if it now looks oversized.
- [ ] **Step 3: Even the stat row** - in `stat-tile.tsx`, make every tile reserve the same vertical space for its delta/caption line so a tile with no delta aligns with the one that has it (e.g. a consistent min-height on the delta row, or render an empty-but-space-holding element when no delta). Do NOT invent deltas for the three tiles that have none (no-fabricated-data). The row should read even because the tiles share a structure, not because fake numbers were added. Keep the sparkline on the one tile that has real data; the others simply have blank reserved space where a delta would go.
- [ ] **Step 4: Verify** - `npm run typecheck && npm run lint && npm run build`. Amber grep clean. Presentational; verify visually in Round 1 browse.
- [ ] **Step 5: Commit** - `git add src/app/(shell)/page.tsx src/components/dashboard/stat-tile.tsx && git commit -m "layout(dashboard): even the stat row and tighten inter-section spacing"`

---

### Task 2: Feed - distill the filter density and clarify with an active-filter summary

Board (feed distill): "~10 filter controls compete at equal weight; let score / timeframe / follower-band lead and the rest recede." Board (feed clarify): "Mixed label syntax; no active-filter summary or one-move reset outside the empty state." In `src/components/feed/filter-bar.tsx` the filters cluster (`:278`) renders fleet + min-score + min-views + min-engagement + timeframe + analyzed all as equal-weight plain triggers; the follower-band row is separate (`:495`); "Clear filters" (`:414`) shows only when `hasActiveFilters`, and there is no persistent summary of which thresholds are active.

**Files:**
- Modify: `src/components/feed/filter-bar.tsx`
- Possibly modify: `src/app/(shell)/feed/(list)/page.tsx` (only if the active-filter summary reads better at page level; prefer keeping it in the filter bar)

- [ ] **Step 1: GitNexus impact** (MCP) on the filter bar component and any exported option constants. Record risk.
- [ ] **Step 2: Distill - give the primary filters lead** - read the whole filter-bar first. Make **score**, **timeframe**, and **follower-band** read as the primary filters (they already drive the core "what over-performed, when, at what account size" question), and let the secondary ones (min-views, min-engagement, analyzed, fleet) recede - e.g. group the secondary filters behind a single "More filters" popover/disclosure, or visually de-emphasize them into a secondary row while the three primaries sit in a prominent first row. Use a native `<details>`/popover or a lighter visual treatment; no new dependency. Keep every filter functional and keep all URL param keys working (do not drop a filter, only re-weight it). Do not touch the sort/layout/density right cluster.
- [ ] **Step 3: Clarify - active-filter summary + one-move reset** - add a persistent active-filter summary that shows which thresholds are currently applied (a row of small neutral chips naming each active filter, e.g. "Score 10x+", "Last 14d", "Nano <10K"), each removable, plus a single "Clear all" that resets every filter in one move. Show it whenever `hasActiveFilters` (reuse the existing `FILTER_PARAM_KEYS`/`hasActiveFilters` at `:244`), not only in the empty state. Chips are neutral (raised surface), never amber. The existing empty-state reset links stay.
- [ ] **Step 4: Clarify - normalize the label syntax lightly** - within reason, make the dropdown option labels read consistently (the board flags "10x+" vs "500K+ views" vs "Any engagement" as mixed). Keep each "Any ..." default; align the active-value phrasing so the units read consistently across score/views/engagement/timeframe. Do not change the underlying values or param encoding - copy only.
- [ ] **Step 5: Verify** - `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`. Amber grep clean. If any filter has a `data-testid` referenced by docs, keep it.
- [ ] **Step 6: Commit** - `git add src/components/feed/filter-bar.tsx && git commit -m "feat(feed): lead with the primary filters and add a persistent active-filter summary with one-move reset"`

---

### Task 3: Vault - honest empty state for Hooks/Styles and a steadier tab layout

Board (vault clarify): "Hooks / Styles tabs have no live save path anywhere yet - an empty tab you can't fill reads as broken, not intentional." Board (vault distill): "Two density models (Saved posts = table, others = card grids) reshuffle the layout on tab switch." In `src/app/(shell)/vault/page.tsx` the Hooks/Styles empty state (`EmptyTemplates`, `:47-66`) describes saving a hook/style "so a remix run can start from it later" and links to `/feed`, but per the file header (`:20-27`) that save destination is not built yet - so the copy implies a save path that does not exist. Saved-posts renders a table (`:191-206`); Scripts/Hooks/Styles render card grids (`:220-233`).

**Files:**
- Modify: `src/app/(shell)/vault/page.tsx` (the `EmptyTemplates` copy and the tab container)

- [ ] **Step 1: GitNexus impact** (MCP) on the vault page and `EmptyTemplates`/`TemplateGrid`. Record risk.
- [ ] **Step 2: Clarify - make the Hooks/Styles empty state honest** - rewrite `EmptyTemplates` copy so an empty tab reads as intentional, not broken. State plainly where hooks/styles come from today (they are captured from prior analyses / kept with their source video) and that there is not yet an in-app "save as template" action - do not imply a working save path that does not exist (no-fabricated-data). Keep the `/feed` link if it is still a sensible next step, but frame it honestly. Confirm the real save state by reading the file header (`:20-27`) and `vault_items` usage before writing copy.
- [ ] **Step 3: Distill - steady the tab-switch layout** - reduce the jarring reshuffle when switching from Saved posts (table) to a card-grid tab. Keep the table for posts (its columns carry real density) and the card grids for the others, but stabilize the surrounding container so only the inner content region changes on tab switch: a consistent outer wrapper width, padding, and min-height so the page frame and the tab bar do not jump. Do not convert the table to cards or vice versa (that would lose real information density); the goal is that the tab switch changes the content region, not the whole page rhythm.
- [ ] **Step 4: Verify** - `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`. Amber grep clean.
- [ ] **Step 5: Commit** - `git add "src/app/(shell)/vault/page.tsx" && git commit -m "clarify(vault): honest Hooks/Styles empty state and a steadier tab layout"`

---

### Task 4: Video detail - in-page Suspense after notFound, isolate the slow query, final polish

Board (video detail optimize): "Five parallel queries paint blank; add a route-local one that doesn't swallow notFound()." Board (harden): "A throw in getSimilarOutliers takes the page down." Board (polish): "a final pass, not rework." Per B-14, do NOT add a route `loading.tsx`. `src/app/(shell)/feed/[videoId]/page.tsx` awaits `getCachedVideoDetail` (`:54`) then `notFound()` (`:55`), then a `Promise.all` (`:58-64`) of `getSimilarOutliers` + 4 others.

**Files:**
- Modify: `src/app/(shell)/feed/[videoId]/page.tsx`
- Possibly create: a small async child component (co-located, e.g. `src/components/video/similar-section.tsx`) that does the slow await inside the Suspense boundary
- Modify: `src/components/video/video-detail.tsx` (only as needed to accept the streamed-in similar section, or to render the skeleton region)

- [ ] **Step 1: GitNexus impact** (MCP) on `VideoDetailPage`, `getSimilarOutliers`, and `VideoDetail`. Record risk; note this is the highest-risk task (page restructure) - warn if HIGH.
- [ ] **Step 2: Keep the notFound gate first** - do NOT move `getCachedVideoDetail`/`notFound()` (`:54-55`). The primary detail must resolve and 404 before anything streams. Confirm generateMetadata's own `getVideoDetail`/`notFound` (deduped via `cache()`) stays as-is.
- [ ] **Step 3: Move the slow query into a Suspense child** - split so the primary `VideoDetail` (fed by `detail`, already awaited) renders immediately, and the slow part (`getSimilarOutliers`, and any other genuinely slow member of the `Promise.all` that only feeds the "similar outliers" section) moves into a child async component rendered inside `<Suspense fallback={<SimilarSkeleton/>}>` placed AFTER the notFound check. Members that the primary detail needs synchronously (e.g. transcript providers gating a button, median basis if the header needs it, feed nav) stay awaited before render unless they are also slow and non-critical - read what each feeds before deciding. The skeleton is square, neutral, no amber.
- [ ] **Step 4: Harden - isolate the slow query's failure** - the similar-outliers async child must catch its own failure (try/catch around `getSimilarOutliers`) and render an inline "couldn't load similar outliers" state (neutral/destructive tone) instead of throwing, so a failure there degrades that one section rather than blanking the whole page via `(shell)/error.tsx`. Confirm the primary detail still renders when the similar query fails.
- [ ] **Step 5: Polish** - a light pass only (board says the amber budget, keyless states, deleted-post alert, sticky action bar are already correct). Do not rework them; just ensure the new skeleton and error state match the existing tone.
- [ ] **Step 6: Verify** - `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`. Framework/route file: verify by build + Round 1 browse (real video id + a forced-throw check if feasible), not a fake render test. Confirm a 404 for a bad videoId still returns 404 (B-14) - test in Round 1 browse by hitting a non-existent id. Amber grep clean.
- [ ] **Step 7: Commit** - `git add "src/app/(shell)/feed/[videoId]/page.tsx" src/components/video/ && git commit -m "optimize(video): stream similar outliers behind in-page Suspense, isolate its failure, keep the notFound gate"`

---

### Task 5: Ideas - surface the hidden command shortcuts

Board (ideas onboard): "The whole command layer (K menu, C/S/E/O/D) is invisible until you guess to press K - surface a shortcut hint." Board (polish): leave the model intact. In `src/components/ideas/idea-inbox.tsx` the K keydown handler (`:242-287`) and the `IdeaCommandMenu` cheat sheet (`src/components/ideas/command-menu.tsx`) exist, but nothing on screen advertises that pressing K opens commands, and Export/Open have no on-screen button at all.

**Files:**
- Modify: `src/components/ideas/idea-inbox.tsx` (add a visible hint)
- Possibly modify: `src/components/ideas/command-menu.tsx` (only if the hint reuses its row data)

- [ ] **Step 1: GitNexus impact** (MCP) on `IdeaInbox` and `IdeaCommandMenu`. Record risk.
- [ ] **Step 2: Add a visible "Press K for commands" affordance** - a small, always-visible neutral hint (a `<kbd>K</kbd>` badge with "commands" label, or a small button that opens the same menu) placed where a user with an idea selected will see it (e.g. near the detail pane's action buttons, or a persistent corner hint). It must not steal amber. Keep the K-driven flow exactly as is (do not change the keydown handler or the menu behavior) - only advertise it. Optionally show the per-action key hints on the existing Create/Shortlist/Discard buttons (they already render buttons at `idea-inbox.tsx:367-389`) using a small `<kbd>`.
- [ ] **Step 3: Polish** - leave the reference model intact (square amber score badge, reversible discard). No rework.
- [ ] **Step 4: Verify** - `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`. Amber grep clean (the kbd hint is neutral).
- [ ] **Step 5: Commit** - `git add src/components/ideas/ && git commit -m "onboard(ideas): surface the K command menu with a visible shortcut hint"`

---

### Task 6: Docs

Component doc dirs are analyze/feed/ig-sync/kit/llm/mine/onboarding/remix/studio. Feed (and its video-detail child) is documented under `feed`; ideas generation is part of `analyze`. Dashboard and vault have no five-doc block, so per the DoD there is nothing to document for those.

**Files:**
- Modify: `documents/architect/core-components/feed/02-architecture.md` (the feed filter distill/clarify - primary filters + active-filter summary; and the video-detail in-page Suspense + isolated similar-outliers failure). Grounded to code, evergreen, no em/en dashes, straight quotes, sentence-case, no line-number citations.
- Modify: `documents/architect/core-components/analyze/03-feature-description.md` (ideas: the K command menu is now advertised with a visible shortcut hint) - only if analyze/03 is where the ideas inbox is described; confirm by reading it first. If ideas is not documented under analyze, note it and skip.

- [ ] **Step 1: Read feed/02-architecture.md**, add short grounded notes on the filter distill/clarify and the video-detail Suspense behavior.
- [ ] **Step 2: Read analyze/03-feature-description.md**; if it covers the ideas inbox, add the shortcut-hint note; else skip and record why.
- [ ] **Step 3: Full gate** - `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`. Tree clean after commit.
- [ ] **Step 4: Commit** - `git add documents/ && git commit -m "docs: feed filter + video-detail streaming and ideas shortcut hint"`

---

## Self-Review

**Spec coverage:** dashboard layout -> T1; feed distill+clarify -> T2; vault clarify+distill -> T3; video-detail optimize+harden+polish -> T4; ideas onboard+polish -> T5; docs -> T6. Cross-cutting optimize(loading)/harden(error) already shipped in Wave 1 (not re-added). No discover surface added to feed/ideas (Goal 5 owns that).

**Placeholder scan:** Tasks are judgment-heavy (filter hierarchy, vault layout, video-detail split) so each step names the file, the exact anchors from the surface map, and the shape to produce; the implementer reads the current code (the components are large and load-bearing). No TBD.

**B-14:** T4 keeps `getCachedVideoDetail` + `notFound()` first, adds only an in-page `<Suspense>` after, and Round 1 browse verifies a bad id still 404s. No route loading.tsx anywhere in this wave.

**Amber Law:** no task adds `*-primary`; filter chips, dashboard tiles, vault copy, video skeleton, ideas kbd hint are all neutral/destructive. Each task ends with a grep check.

**No-fabricated-data:** T1 evens the stat row by layout, never by inventing deltas; T3 vault copy is honest about the missing save path.
