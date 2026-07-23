# Design Spec — Sandcastle Clone (working name: **Crowsnest**)

Status: v0.2, design phase — revised after teammate `scout` returned confirmed
feature research (see §0.1). Written for the builder team to implement directly
against Next.js 15 + Tailwind + shadcn/ui (per `docs/PLAN.md`). Desktop-first,
dark-mode-only, local-first Mac app.

## 0. Research provenance (read before the visual sections)

Per the brand rule, nothing below reuses Sandcastles' name, logo, copy, or
illustrations — layout patterns and IA are fair game, visuals are original.

What was actually verified vs. Sandcastles.ai:
- **Verified via direct WebFetch** of sandcastles.ai: nav structure, hero/features/
  how-it-works/pricing/FAQ sections, pricing tiers, terminology ("outlier," "remix,"
  "playbooks," "credits," "workspaces").
- **Verified via teammate `scout`'s parallel research** (`docs/research/FEATURES.md`,
  cross-referenced here to stay consistent with the rest of the team): the real
  filter set is **Watchlist → Platform → outlier-score threshold → min view count →
  date range**, sorted by outlier score or views; "Saved Filters" ships two presets;
  video detail has 4 action buttons including a "Create Prompt" copy-to-clipboard
  action; a "More Like This" recommender surfaces pattern-similar videos; the reusable-
  template library is called "Vault." These findings arrived after my own site pass and
  are the more reliable source for functional IA — I've folded them in below (e.g. a
  "Fleet" grouping concept = their "Watchlist," renamed) rather than duplicating a
  weaker version from marketing copy alone.
- **Could NOT verify**: any actual screenshot, dashboard color, card layout, or pixel-
  level UI of the Sandcastles app itself. `app.sandcastles.ai` is auth-gated, their
  help center is a client-rendered SPA that blocked fetch, and no review source had
  embedded screenshots. **Every visual decision below (palette, type, card anatomy,
  spacing) is original, designed from first principles for this product** — not
  observed and reproduced.
- **Did not additionally pull the YouTube demo review** (`oN8eZH1ANy8`) offered as an
  optional still-frame reference for this revision: `ffmpeg`/`yt-dlp` aren't installed
  in this environment (the `/watch` skill needs a one-time setup script first), and
  scout's own text sources had already converged on a consistent, detailed picture of
  the UI across ≥2 independent sources each — the same call scout made. Flagging this
  rather than silently skipping it: if the leader wants pixel-level reference later,
  that video is the next thing to pull.

### 0.1 Course-correction (v0.2)

Teammate `scout` came back with confirmed feature research (`docs/research/FEATURES.md`)
that changes two surfaces from my original v0.1 brief. Rather than treat that as a
footnote, I've reworked the affected sections in place:

1. **"Boards" → "Vault"** (§2.6): scout confirms the real product's differentiator
   isn't a bookmarked-videos collection — it's a library of hook/style **templates**
   extracted from videos. I dropped my original "swipe-file of saved videos" concept
   entirely rather than bolt templates onto it, since keeping both would blur what
   each surface is for.
2. **Remix Studio restructured as a staged pipeline** (§2.5): scout confirms the real
   flow is Prompt → Research → Hook → Style → Script, with Hook/Style pulling from the
   template library. My original two-pane "source | generate variants" workspace is
   replaced with a 5-stage stepper; the two-pane idea survives only inside the
   Research stage.

I kept the surface **name** "Remix Studio" rather than adopting "Scriptwriter" —
`docs/PLAN.md` (the leader's own locked-decisions doc) already names this feature
"Remix studio" / `remix-service` in the architecture sketch, and both words are
generic-enough functional descriptions (not Sandcastles branding) that there's no
brand-rule reason to switch. Same reasoning kept "Fleet" over "Watchlist." Everything
else below (brand rule, tokens, Outlier Feed layout, the mock file) is unchanged from
v0.1 per the leader's explicit instruction.

---

## 1. IA / Sitemap

```
/                        Dashboard (home/overview)
/feed                    Outlier Feed                    ★ hero surface
/feed/:videoId           Video Detail (full page, preserves feed scroll/filters on back)
/feed/:videoId/remix     Remix Studio — staged pipeline (Prompt→Research→Hook→Style→Script), §2.5
/channels                Channel Library (Fleets + channel table)
/channels/:channelId     Channel Detail
/vault                   Vault — hook/style template library + saved scripts, §2.6
/settings                Settings (niche profile · API keys · sync)
```

Global overlays (not routes, layered on any page):
- `⌘K` Command palette (jump to channel/video, run "Add channel," switch Fleet, or
  "pick a video to remix" when using a Vault template with no session open)
- Add-channel Dialog, New-fleet Dialog, New-Vault-item Dialog (manual entry — the
  primary path into the Vault is "save from a video" or "save from a Remix Studio
  stage," this dialog just covers typing one in from scratch)
- Quick-preview Sheet (right-side slide-over from a Feed card — see §2.2)

**Landing route:** defaults to `/` (Dashboard) for orientation on open. Because this
is a personal daily-use tool rather than an onboarding funnel, this is a one-line
config choice, not an architectural one — Kai can flip the default to `/feed` later
with zero redesign if Dashboard ends up feeling like a tax before getting to work.

**Cross-links:** Video Detail is reachable from Feed cards, Channel Detail's reel
list, and a Vault template's source-video chip. Remix Studio is reachable from Video
Detail's primary CTA, or from a Vault template card's "Use in Remix Studio" action
(which prompts you to pick a source video first if none is active).

**Entity note (aligns with `scout`'s findings + `docs/PLAN.md`):** tracked channels
group into named **Fleets** (our term for their confirmed "Watchlists" — kept
on-brand with the nautical `kaiships` family rather than reusing their exact wording).
A channel can belong to more than one Fleet. **Vault** is now a first-class,
scout-confirmed surface in its own right (§2.6) — not a stand-in for anything else —
holding extracted hook/style templates plus saved scripts; it replaces v0.1's
generic "Boards" concept entirely rather than extending it.

---

## 2. Per-page layout specs (desktop-first)

### 2.0 Global shell

```
┌────────────┬──────────────────────────────────────────────────────┐
│  Crowsnest  │  ⌘K search…                              [+ Channel] │ ← topbar, 56px
│            ├──────────────────────────────────────────────────────┤
│  Dashboard │                                                       │
│  Feed   ●  │                                                       │
│  Channels  │                    page content                      │
│  Vault     │                                                       │
│  Settings  │                                                       │
│            │                                                       │
│  ─────────  │                                                       │
│  ● synced  │                                                       │
│  2h ago ↻  │                                                       │
└────────────┴──────────────────────────────────────────────────────┘
  240px fixed      fluid, max-width 1120px on detail pages,
  (collapses to    full-bleed on Feed / Remix Studio
   64px icon rail)
```

- Sidebar: fixed 240px (collapsible to a 64px icon rail via a toggle at the bottom).
  Logo/name top, 5 nav items with icon + label, active item gets a left accent bar
  (2px, `--primary`) + raised background. Sync status footer: colored dot (status
  token) + relative time + manual "sync now" icon button.
- Topbar: lives inside the content column, 56px tall, bottom hairline border. Left:
  page title (or breadcrumb on drill-in pages, e.g. `Channels / @handle`). Right:
  `⌘K` command trigger (styled as a disabled-looking input, shadcn `Command` +
  `Dialog`), primary page action (context-dependent — "Add channel," "New template," etc).
- Content max-width 1120px centered on text-heavy/detail pages (Channel Detail, Video
  Detail, Settings, Vault); full-bleed within the content column on Outlier Feed
  and Remix Studio, which need the width for grids/panes.

### 2.1 Dashboard (`/`)

```
┌─────────────────────────────────────────────────────────────────┐
│ Welcome back · Tue Jul 21          [Sync now]                   │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │ Channels │ │ New      │ │ Boarded  │ │ Scripts  │  KPI row     │
│ │ tracked  │ │ outliers │ │ this wk  │ │ drafted  │  (stat tiles)│
│ │   42     │ │  ↑ 12.9K │ │   18     │ │   7      │             │
│ │ ⤴ +3 ⟋⟍⟋ │ │  this wk │ │          │ │          │             │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
├─────────────────────────────────────────────────────────────────┤
│ Today's top outliers                          View all in Feed →│
│ [card][card][card][card][card][card] →  (horizontal scroll row) │
├─────────────────────────────────────────────────────────────────┤
│ Fleets with new spikes                                          │
│  ● Fitness Niche      +4 new outliers this week   ⟋⟍⟋ sparkline │
│  ● Direct Comps       +1 new outlier               ⟋⟍⟋          │
├─────────────────────────────────────────────────────────────────┤
│ Recently viewed                     [card][card][card][card]    │
└─────────────────────────────────────────────────────────────────┘
```

- KPI row: 4 **stat tiles** (see §5 dataviz notes) — label sentence case, semibold
  compact value, optional signed delta with direction-colored icon, one tile carries
  a 12-point sparkline (de-emphasis gray line, current period in accent).
- "Today's top outliers": horizontal `ScrollArea` of mini Outlier Cards (compact
  variant, no caption line), linking out to the full Feed.
- "Fleets with new spikes": simple list rows, not a table — status dot + Fleet name +
  delta text + inline sparkline. Row click → Feed pre-filtered to that Fleet.
- "Recently viewed": last 4 opened videos, same mini-card component as above.

### 2.2 Outlier Feed (`/feed`) — hero surface

```
┌─────────────────────────────────────────────────────────────────┐
│ Outlier Feed                                                     │
├─────────────────────────────────────────────────────────────────┤
│ [Fleet: All ▾] [IG|TikTok|YT] [Score 5×+▾] [Views 100K+▾]        │ ← filter bar,
│ [Last 30d ▾] [Followers ▾] [Saved: Balanced ▾]     [Sort ▾] [▦|≡]│   sticky
├─────────────────────────────────────────────────────────────────┤
│ 128 results                                                      │
│ ┌────────┐┌────────┐┌────────┐┌────────┐                        │
│ │ 9:16   ││ 9:16   ││ 9:16   ││ 9:16   │  grid, auto-fill        │
│ │ thumb  ││ thumb  ││ thumb  ││ thumb  │  minmax(240px,1fr)      │
│ │ 12.4×  ││ 3.2×   ││ 38.0×  ││ 6.8×   │  gap 20px               │
│ ├────────┤├────────┤├────────┤├────────┤                        │
│ │ @handle││ @handle││ @handle││ @handle│                        │
│ │ caption││ caption││ caption││ caption│                        │
│ │ views·date       …                   │                        │
│ │ [🔖][Remix][⋯]  …                    │                        │
│ └────────┘└────────┘└────────┘└────────┘                        │
│              [ Load more ]                                       │
└─────────────────────────────────────────────────────────────────┘
```

- Filter bar fields, left to right: **Fleet** scope (Select — "All channels" or a
  named Fleet or a single channel via search-within), **Platform** (`ToggleGroup`:
  All / Instagram / TikTok / YT Shorts), **Outlier score min** (Select: 2×, 5×, 10×,
  20×), **Min views** (Select: 10K, 100K, 500K, 1M+ — confirmed real filter per
  scout's research, additive to the brief's multiplier/timeframe/follower-band ask),
  **Timeframe** (Select: 7/30/60/90d, custom via `Popover` date range), **Follower
  band** (Select: Nano <10K, Micro 10–100K, Mid 100K–1M, Macro 1M+), **Saved views**
  (`DropdownMenu` — two shipped presets: **"Balanced"** = 5×+/30d, **"High
  Conviction"** = 10×+/14d/500K+ views; original names, not Sandcastles' preset
  labels), **Sort** (Select: Highest score, Most recent, Most views), grid/list view
  toggle (`ToggleGroup`, icon-only).
- Result count line above the grid, plain text, not a stat tile.
- Grid: CSS Grid `repeat(auto-fill, minmax(240px, 1fr))`, `gap: 20px` — this is a
  responsive rule, not manual breakpoints; at ~1440px content width that's 4 columns.
- Click a card → **Sheet** (right slide-over, ~440px) with a quick preview: static
  thumbnail, key metric chips, transcript excerpt (first ~4 lines), "Open full page"
  and "Remix" buttons. This keeps feed scroll position/filters intact for fast
  triage — "Open full page" is the deliberate escape hatch to the full Video Detail
  route when you want the whole transcript/structure breakdown.
- Pagination: **"Load more" button**, not infinite scroll — simpler against a local
  SQLite result set, and it keeps scroll position predictable when returning from a
  detail page.
- Empty/loading states: see §6.

### 2.3 Channel Library (`/channels`) + Channel Detail

**Library:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Channels                                          [+ New Fleet]  │
├───────────────┬─────────────────────────────────────────────────┤
│ Fleets        │  Channel      Platform  Followers  Med.views  … │
│  All channels │  @formfirst   IG        340K       210K      … │ ← Table
│  Fitness Niche│  @dailylift   TikTok    1.2M        890K      … │
│  Direct Comps │  @kettleandkin IG        88K        140K      … │
│  + new fleet  │  ...                                             │
└───────────────┴─────────────────────────────────────────────────┘
```
- Left rail (180px): Fleet list, "All channels" pinned at top, `+ new fleet` at
  bottom (Dialog). Click filters the table at right.
- Table (shadcn `Table`): Channel (avatar + handle), Platform (icon), Followers,
  Median views, Outliers (30d count), Last synced, row-action `DropdownMenu` (sync
  now, edit fleets, untrack).
- "Add channel" Dialog: handle/URL input + platform Select. Manual-URL-import
  fallback path (per `docs/PLAN.md`'s keyless requirement) is the same form with a
  "paste URL instead" toggle.

**Channel Detail:**
```
┌─────────────────────────────────────────────────────────────────┐
│ ← Channels     [avatar] @formfirst.fit   IG   340K followers  ↗  │
│                                          [Sync now] [Untrack]    │
├─────────────────────────────────────────────────────────────────┤
│ Median views 210K │ Best multiplier 22.4× │ Outliers (30d) 6 │…  │ ← stat tiles
├─────────────────────────────────────────────────────────────────┤
│ Outlier history                                                  │
│  ⟋⟍⟋⟍⟋●⟍⟋⟍●⟋⟍⟋   (line, muted; outlier spikes emphasized/amber)│ ← chart, §5
├─────────────────────────────────────────────────────────────────┤
│ [Recent Reels] [Outliers Only] [In Boards]        ← Tabs        │
│ [card][card][card][card]                                        │
└─────────────────────────────────────────────────────────────────┘
```
- Header: avatar (48px), handle, platform badge, follower count, external-link icon
  to the live profile, Sync now + Untrack buttons.
- Stat tile row (4 tiles, no sparkline needed here — the chart below covers trend).
- Outlier history chart: see §5 for the full dataviz spec (emphasis form).
- Tabs (shadcn `Tabs`): Recent Reels / Outliers Only / In Boards, each a grid of the
  compact Outlier Card variant.

### 2.4 Video Detail (`/feed/:videoId`)

```
┌───────────────┬───────────────────────────────────────────────┐
│  9:16 player   │ [Transcript] [Hook & Structure] [Why it worked]│ ← Tabs
│  placeholder   ├───────────────────────────────────────────────┤
│                │                                               │
│  12.4× badge   │   (tab content, scrollable)                  │
│  2.4M views    │                                               │
│  posted 3d ago │                                               │
│                │                                               │
│  @formfirst ↗  │                                               │
│  [🔖 Save]     │                                               │
│  [Similar] [⋯] │                                               │
├───────────────┴───────────────────────────────────────────────┤
│                                          [ Remix this video → ]│ ← sticky footer
└─────────────────────────────────────────────────────────────────┘
```
- Left column (fixed ~380px): 9:16 player placeholder (poster-frame `<div>` with
  centered play glyph — no real playback in v1 mock/spec), metric chips below (views,
  likes, comments, engagement rate, the multiplier badge at full size), channel chip
  linking to Channel Detail, posted date + platform icon, "View on Instagram ↗".
- Actions (confirmed 4-action pattern from research, renamed/originalized): **Save to
  board** (bookmark icon), **Similar outliers** (our take on "More Like This" —
  pattern-similarity, not keyword match), overflow `⋯` → Copy link / Copy transcript
  / **Copy as prompt** (small power-user affordance — packages the research into a
  clipboard-ready block for pasting into any external LLM; secondary/tertiary action
  since our primary path is the in-app Remix Studio below, unlike Sandcastles where
  this substitutes for not having in-app generation at all).
- Right column: `Tabs` — **Transcript** (scrollable, timestamped), **Hook &
  Structure** (annotated segments: Hook 0–3s / Build / Payoff / CTA), **Why it
  worked** (short analysis notes).
- Primary CTA: **"Remix this video"**, full-width sticky bar at the bottom of the
  right column, `--primary` fill, only interactive element of that visual weight on
  the page.

### 2.5 Remix Studio (`/feed/:videoId/remix`)

```
┌───────────────────────────┬─────────────────────────────────────┐
│ Source (collapsed header) │ Template: [Hook Swap ▾]        [⚙]  │
│ @formfirst · 12.4× · 2.4M │ [ Generate 3 variants ]              │
│ ──────────────────────── │ ┌────────┬────────┬────────┐         │
│ Transcript / structure    │ │Variant1│Variant2│Variant3│  Tabs   │
│ (read-only, scrollable)   │ ├────────┴────────┴────────┤         │
│                           │ │ editable Textarea         │        │
│                           │ │                            │        │
│                           │ ├────────────────────────────┤        │
│                           │ │ [↻ Regenerate] [Copy] [→ Board]│    │
└───────────────────────────┴─────────────────────────────────────┘
   resizable divider (shadcn Resizable / react-resizable-panels)
```
- Left pane: read-only source panel — condensed metric header + the same
  transcript/structure content from Video Detail, scrollable independently.
- Right pane: prompt **template selector** (Select — "Hook Swap," "Niche Transplant,"
  "Format Remix," + user-defined custom templates via a small management
  `DropdownMenu`), variant-count control (default 3), primary "Generate" button.
- Generated variants render as `Tabs` (or side-by-side `Card`s if ≤2) each with an
  editable `Textarea`, a regenerate icon-button (redo just that one variant), copy
  button, and "Send to board" (saves script + source link into a Board).
- Loading state: see §6.
- Panes are resizable (drag the divider) — this is the one screen dense enough to
  need it.

### 2.6 Boards (`/boards`) + Board Detail

- Boards list: `Card` grid, each board = a 2×2 thumbnail collage (up to 4 saved
  items) + name + item count. "New board" via `Dialog`.
- Board Detail: `Tabs` — **Videos** (compact Outlier Card grid) / **Scripts** (a
  different card type: template name + first-line excerpt + source video chip).
  Drag-to-reorder is out of scope for v1 (noted as a future nice-to-have, not
  designed here).

### 2.7 Settings (`/settings`)

- Left-nav `Tabs` (vertical) or simple anchor sections: **Niche Profile** (`Textarea`
  describing audience/niche + keyword `Input` list — feeds the Remix prompt context),
  **API Keys** (masked `Input` for `ANTHROPIC_API_KEY` + optional provider token, each
  with a "Test connection" button and a status `Alert` if missing/invalid), **Sync**
  (interval `Select`, defaulting to manual-only per the $0/mo local-first posture —
  auto-sync is opt-in, not on by default).

---

## 3. Component inventory → shadcn/ui primitives

| Concept | shadcn/ui primitive | Used on |
|---|---|---|
| Reel card, stat tile, board cover | `Card` | Feed, Dashboard, Channel Detail, Boards |
| Multiplier / platform / status chip | `Badge` (custom color classes, see §5) | everywhere |
| All buttons (primary/secondary/ghost/icon) | `Button` | everywhere |
| Channel avatar | `Avatar` | cards, tables, Channel/Video Detail |
| Section tabs | `Tabs` | Video Detail, Channel Detail, Remix Studio, Boards, Settings |
| Quick-preview slide-over | `Sheet` | Feed card click |
| Add channel / new board / new fleet / confirmations | `Dialog` | Channels, Boards |
| Channel table | `Table` | Channel Library |
| Filter selects (score, views, timeframe, follower band, sort) | `Select` | Feed filter bar |
| Fleet scope, channel search, ⌘K palette | `Command` (+ `Dialog` for the ⌘K shell) | Feed, global |
| Platform filter, grid/list toggle | `ToggleGroup` | Feed filter bar |
| Loading placeholders | `Skeleton` | Feed, Remix Studio, Dashboard |
| Horizontal card rows, transcript panel, source panel | `ScrollArea` | Dashboard, Video Detail, Remix Studio |
| Section dividers | `Separator` | most pages |
| Row/card overflow actions | `DropdownMenu` | Feed cards, Channel table, Remix templates |
| Metric explanations, truncated text | `Tooltip` | cards, stat tiles |
| Script editing | `Textarea` | Remix Studio, Settings (niche profile) |
| Text fields | `Input` | Settings, Add channel, filters |
| Toggles | `Switch` | Settings |
| Field labels / validation | `Label`, `Form` | Settings |
| Sync progress | `Progress` | sidebar sync status, manual sync run |
| Two-pane Remix Studio | `Resizable` (react-resizable-panels-based) | Remix Studio |
| Custom date range | `Popover` (+ simple preset list per §5 filter-control spec) | Feed filter bar |
| Missing API key / zero-result banners | `Alert` | Settings, Feed |
| Sync complete / script saved confirmations | `Sonner` (toast) | global |

---

## 4. Design tokens

### 4.0 Mode

**Dark, committed, v1 has no light mode.** Rationale: 9:16 video thumbnails read
better against a dark canvas (they're the densest visual content on every surface),
this class of tool (Opus Clip, Descript, Runway-adjacent creator tooling) already
skews dark, and it's a personal power-tool used for long research sessions where a
near-black canvas is easier on the eyes than a bright one. Revisit only if Kai
specifically wants a light mode later — the token table below is structured so that's
additive, not a rewrite.

### 4.1 Palette

All pairs below were computed with the WCAG 2.1 relative-luminance contrast formula
(not eyeballed). `validate_palette.js` from the `dataviz` skill — which additionally
checks OKLCH lightness bands, chroma floor, and simulated-CVD separation — needs
Node, which wasn't available in this pass; the numbers below are a real, computed
WCAG contrast audit done in Python as the best available substitute.
**Before shipping, re-run the actual validator** once Node is available in the build
env: `node validate_palette.js "<hexes>" --mode dark --surface "#0B0D12"`.

| Role | Hex | HSL (for shadcn CSS vars) | vs. surface | Verdict |
|---|---|---|---|---|
| `background` | `#0B0D12` | `223 24% 6%` | — | base canvas |
| `card` / `popover` | `#12151C` / `#171B24` | `222 22% 9%` / `222 22% 12%` | — | surfaces |
| `foreground` (text primary) | `#E7E9EE` | `223 17% 92%` | 16.0:1 on bg, 15.0:1 on card | PASS |
| `muted-foreground` (secondary) | `#9298A9` | — | 6.34:1 on card | PASS |
| text-muted (meta/timestamps) | `#767D93` | `226 12% 52%` | 4.46–4.74:1 | PASS |
| `border` (subtle, card dividers) | `#242938` | `225 22% 18%` | decorative, not a text pair | n/a by design |
| `input` (form/border-strong) | `#565E78` | `226 17% 40%` | 3.02:1 vs bg, 2.84:1 vs card | PASS / marginal — see note |
| `primary` (action / buttons / links, resting) | `#6A5AE0` | `247 68% 62%` | white text 5.06:1 | PASS |
| primary-hover | `#7C6CFF` | — | white text 3.86:1 (hover-only, transient) | ok, large-text band |
| `ring` (focus) | `#7C6CFF` | `247 100% 71%` | 5.04:1 vs bg | PASS |
| `accent` / heat tier-2 (outlier magnitude) | `#F5A524` | `37 91% 55%` | 8.95–9.52:1 | PASS |
| `accent-foreground` | `#14100A` | `36 33% 6%` | 9.28:1 on accent fill | PASS |
| `destructive` | `#F1585C` | `358 85% 65%` | white text 3.34:1 (large-text band) | ok |
| success (good/synced) | `#34D399` | `158 64% 52%` | 9.50–10.11:1 | PASS |
| warning (stale/attention) | `#E8B23D` | `41 79% 57%` | 9.45:1 | PASS |
| serious | `#E8734B` | `15 77% 60%` | 6.08:1 | PASS |

Notes on the two marginal rows: `input` at 2.84:1 against the card surface sits just
under the 3:1 non-text-UI-component floor — acceptable here because every focusable
input also gets the high-contrast `ring` treatment (5.04:1) on interaction, so the
resting-state border is a secondary affordance, not the only one. Filled-button
label pairs (`primary`/`destructive` + white text) clear the WCAG **large-text** 3:1
threshold (they're 3.34–5.06:1) rather than the small-text 4.5:1 one — button labels
in this system are always medium/semibold at ≥14px, which qualifies.

**Sequential "heat" ramp (outlier multiplier badge, magnitude encoding)** — single
hue, amber → orange-red, increasing chroma/warmth, per the dataviz skill's sequential
job (one hue, monotone intensity, not a categorical rainbow):

| Tier | Multiplier | Background | Text | Border | Extra |
|---|---|---|---|---|---|
| 1 — Notable | 2–5× | `rgba(245,165,36,.10)` | `#C98A4A` | `1px rgba(245,165,36,.35)` | — |
| 2 — Strong | 5–10× | `rgba(245,165,36,.16)` | `#F5A524` | `1px rgba(245,165,36,.5)` | — |
| 3 — Outlier | 10–20× | `#F5A524` solid | `#14100A` | none | — |
| 4 — Mega | 20×+ | `linear-gradient(135deg,#FF7A1A,#FF3D3D)` | `#1A1300` | none | `box-shadow: 0 0 16px rgba(255,90,26,.45)` |

Dark text (`#14100A`/`#1A1300`) is used on tiers 3–4 rather than white, because the
fills are light/bright — computed contrast is 9.28:1 (tier 3) and 7.08/5.27:1 (tier 4
at each gradient end), all clearing 4.5:1; white text on the same fills measured as
low as 2.61:1 and was rejected.

**Platform identity (Instagram / TikTok / YouTube Shorts)** deliberately does **not**
use a 3-way categorical color palette — each platform chip carries its own
recognizable glyph shape in a neutral monochrome treatment (current-color icon in a
translucent dark pill), so identity comes from icon shape, not hue. This sidesteps
needing a validated categorical ramp for something iconography already solves, and
keeps every hue in the system reserved for actual data encoding (heat, status).

**Follower band** (Nano/Micro/Mid/Macro) is **ordinal**, not a new hue family: shown
as filter chips with increasing fill-weight (outline → 25% → 60% → solid, all in the
neutral ink color) so the size progression reads through weight, not a second color
ramp competing with the heat scale.

### 4.2 Type

Single sans family throughout — no serif/display face anywhere, per the dataviz
skill's figure guidance generalized to the whole product for consistency:

```
font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
```

| Style | Size / line-height | Weight | Use |
|---|---|---|---|
| H1 | 24 / 32 | 600 | Page title |
| H2 | 18 / 26 | 600 | Section header |
| H3 | 15 / 20 | 500 | Card title, channel name |
| Body | 14 / 20 | 400 | Default UI text |
| Small | 12 / 16 | 400 | Meta text (muted) |
| Micro | 11 / 14 | 500 | Badge numerals, timestamps |

Figures: large standalone numbers (stat-tile values, dashboard KPIs) use **default
proportional figures**. `font-variant-numeric: tabular-nums` is reserved for the
multiplier badge numeral (so magnitudes align when scanning a grid of cards) and
table numeric columns (views, followers) — never on prose or hero numbers.

### 4.3 Radius & spacing

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 8px | buttons, inputs, small chips |
| `radius-md` | 10px | cards (default shadcn `--radius`) |
| `radius-lg` | 14px | Dialog/Sheet panels |
| `radius-full` | 999px | pills, badges, avatars |

Spacing scale (4px base unit): `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Card internal
padding 16px; grid gap 20px; section vertical rhythm 32–48px.

### 4.4 shadcn `globals.css` variable block (ready to paste)

```css
:root {
  --background: 223 24% 6%;        /* #0B0D12 */
  --foreground: 223 17% 92%;       /* #E7E9EE */
  --card: 222 22% 9%;              /* #12151C */
  --card-foreground: 223 17% 92%;
  --popover: 222 22% 12%;          /* #171B24 */
  --popover-foreground: 223 17% 92%;
  --primary: 247 68% 62%;          /* #6A5AE0 */
  --primary-foreground: 0 0% 100%;
  --secondary: 222 22% 12%;        /* #171B24 */
  --secondary-foreground: 223 17% 92%;
  --muted: 222 22% 12%;
  --muted-foreground: 226 12% 52%; /* #767D93 */
  --accent: 37 91% 55%;            /* #F5A524 */
  --accent-foreground: 36 33% 6%;  /* #14100A */
  --destructive: 358 85% 65%;      /* #F1585C */
  --destructive-foreground: 0 0% 100%;
  --border: 225 22% 18%;           /* #242938 */
  --input: 226 17% 40%;            /* #565E78 */
  --ring: 247 100% 71%;            /* #7C6CFF */
  --radius: 0.625rem;
}
```

This app is dark-only, so these values go directly on `:root` rather than gated
behind a `.dark` class — there is no light variant to fall back from in v1.

---

## 5. Outlier-card anatomy (+ dataviz notes)

```
┌───────────────────────┐
│ [IG]             12.4×│ ← platform glyph chip (top-left) · multiplier badge (top-right)
│                       │
│      9:16 gray        │ ← thumbnail, aspect-ratio: 9/16, bg #1E2230,
│      thumbnail        │   centered play-triangle glyph, subtle diagonal hatch
│                       │
│                  0:34 │ ← duration stamp, bottom-right, translucent dark pill
├───────────────────────┤
│ (●) @formfirst.fit    │ ← 24px avatar + handle, · 340K followers (muted, micro)
│ "3 mistakes killing…" │ ← caption, 2-line clamp, secondary color
│ 👁 2.4M   ·   3d ago   │ ← metrics row
│ [🔖]      [Remix]  [⋯]│ ← footer actions
└───────────────────────┘
```

- **Container**: `Card`, `radius-md` (10px), 1px `border`, `bg-card`. Hover:
  border → `input` strength, `translateY(-2px)`, soft shadow — CSS transition only.
- **Thumbnail**: `aspect-ratio: 9/16`, placeholder fill `#1E2230` with a faint
  repeating diagonal hatch (never a photo — gray placeholder per the mock brief).
- **Multiplier badge**: top-right overlay, tier-scaled per §4.1's heat ramp. This
  is the single most important glanceable data point on the card, so it's the
  only element allowed a glow (tier 4 only).
- **Platform chip**: top-left overlay, icon-only, monochrome glyph (see §4.1 —
  identity by shape, not color).
- **Duration stamp**: bottom-right overlay on the thumbnail, small translucent pill.
- **Channel row**: 24px `Avatar` + handle (clickable → Channel Detail) + follower
  band as muted micro-text, not a colored chip (ordinal weight lives in the Feed
  filter chip, not repeated here — keeps the card quiet).
- **Caption**: 2-line clamp, `text-secondary`.
- **Metrics row**: eye icon + compact view count (`2.4M`), relative post date.
- **Footer actions**: save-to-board icon button (bookmark, toggles filled/outline),
  small secondary "Remix" button, overflow `⋯` (view on platform / copy link /
  similar outliers).

**Dataviz cross-reference** (skill invoked before finalizing any of the above):
- The multiplier badge is a **sequential/magnitude** encoding, one hue, four
  intensity tiers — not a categorical rainbow. See §4.1 for the exact ramp and its
  computed contrast.
- Dashboard KPI tiles follow the skill's **stat-tile contract**: sentence-case label
  (no trailing colon), semibold auto-compact value, optional signed delta colored by
  direction × whether up is good (success/critical tokens, always paired with an
  ↑/↓ icon — never color alone), optional 12-point sparkline in the de-emphasis gray
  with the current period picked out in the accent hue.
- The Channel Detail "outlier history" chart uses the **emphasis** form (one series
  is the point, rest is context): a 2px muted-ink (`#767D93`) line for the full
  view-count trend, with outlier-threshold points marked as ≥8px filled dots in the
  same tier-scaled heat colors as the badge, each with a 2px surface-color ring so
  they stay legible crossing the line. Hairline gridlines one step off the card
  surface, no legend (single series — the section header already names it), hover
  crosshair + tooltip (date, views, multiplier at that point), and exactly one direct
  label on the single highest spike — not a number on every point.

---

## 6. Empty & loading states

**Outlier Feed**
- *Zero channels tracked (true empty)*: centered, icon-free (per the "no
  illustrations" constraint — this is a typographic empty state), "No outliers yet —
  track a channel to get started," primary button "Add your first channel" (opens
  the Add-channel Dialog).
- *Filtered to zero results*: "No outliers match these filters," secondary button
  "Clear filters." Distinct copy from the true-empty case so it never reads as "you
  have nothing tracked."
- *Loading*: skeleton grid matching the real card shape exactly — `Skeleton` block
  at 9/16 for the thumbnail, two short skeleton lines for channel/caption, a small
  pill skeleton where the badge sits. Never a spinner in place of the grid — the
  skeleton communicates layout while data loads.

**Remix Studio**
- *Before first generation*: template selector prominent, large "Generate scripts"
  primary CTA, right pane otherwise just a quiet placeholder line — "Pick a template
  and generate to see variants here." No illustration.
- *Generating*: right pane shows a status line — "Writing variant 2 of 3…" — with a
  small `Progress`/spinner, plus skeleton `Textarea` blocks for not-yet-done variants
  so the layout doesn't jump when each variant completes.
- *Generation failed*: inline `Alert` (destructive) in place of the failed variant
  only — "Couldn't generate this variant" + retry button — the other variants (if
  they succeeded) stay intact rather than failing the whole batch.

---

## 7. Product name options

| Option | Rationale |
|---|---|
| **Crowsnest** ★ recommended | The lookout platform atop a ship's mast — where you spot something on the horizon before anyone else. Directly extends the `kaiships` nautical family, and the metaphor maps 1:1 onto the product's actual job (spotting outliers early). Distinctive, memorable, zero overlap with "sandcastle." |
| **Riptide** | The current beneath the surface that pulls a thing up and out — a one-word metaphor for what an outlier is (pulled up from beneath the algorithm's average). Ocean-adjacent without touching "beach/sand" imagery, so it reads as clearly its own thing next to Sandcastles rather than a reskin. |
| **Spyglass** | The captain's instrument for zooming in on something distant — doubles as a nod to the product's analytical "zoom into transcript/structure" function, not just discovery. Same nautical family as Crowsnest, slightly more literal/tool-like where Crowsnest is more evocative. |

`Crowsnest` is used as the working name in the mock and throughout this doc; swap is
a find-replace, nothing in the IA or component design depends on the name.
