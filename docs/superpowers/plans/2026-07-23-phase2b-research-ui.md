# Crowsnest Phase 2B — Research UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The research surfaces on seed data: Outlier Feed (filters, heat-tiered cards, quick-preview Sheet), Channel Library + Detail, and the Video Detail shell — everything DESIGN.md §2.2–§2.4 specifies, minus phase-3 AI features (placeholders).

**Architecture:** Read path only. New `src/server/queries/**` layer (framework-free, Vitest-tested against the phase-1 `seedDatabase` in-memory) feeds server components; client components only where interaction demands (filter bar, Sheet, dialogs). Visual truth: `docs/design/DESIGN.md` §2.0–§2.4 (layouts), §4 (tokens — already applied in phase 1), §5 (card anatomy + heat ramp + chart spec), §6 (empty/loading states). Where DESIGN.md says "Boards", read "Vault" (spec §6 conflict rule).

**Tech Stack:** Next.js App Router (server components + server actions), shadcn/ui primitives installed in phase 1, Drizzle queries.

## Global Constraints

- **File zone (parallel-safety):** create/modify ONLY `src/app/**`, `src/components/**` (except `src/components/ui/**` — shadcn generated, read-only), `src/lib/**`, `src/server/queries/**`. NEVER touch `src/server/providers|transcribe|services|actions|lib/**`, `tests/fixtures/**`, or README — phase 2A owns those and runs in parallel.
- **2A coupling bridge:** the ONLY file allowed to reference phase-2A modules is `src/components/channels/sync-bridge.ts` (Task 5). Until integration it exports typed stubs that return `{ ok: false, error: "Sync engine lands with phase 2A — button wired at integration" }`. Everything else must compile and run standalone on this branch.
- Shell PATH: start every bash block with `export PATH="/Users/kienbeovl/.local/bin:/opt/homebrew/bin:$PATH"`.
- Dark-only tokens from phase 1; heat-ramp values verbatim from DESIGN.md §4.1 (tier bounds: 2–5×, 5–10×, 10–20×, 20×+; tier-4 gradient `#FF7A1A→#FF3D3D` with glow; dark text on tiers 3–4). Null score renders "—" chip, never a fake number.
- Every user-visible string original — no Sandcastles copy. Product name Crowsnest.
- TS strict, no `any`. Every task: `npm run build && npm test` green → commit (conventional + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).
- Follower bands: nano <10K, micro 10K–100K, mid 100K–1M, macro ≥1M (DESIGN.md §2.2).
- **Test-DB pattern (phase-1 final-review M7):** the db singleton binds `CROWSNEST_DB_PATH` at import — every query test MUST copy `seed.test.ts`'s pattern (`beforeAll` sets env to `:memory:`, then dynamic `await import`, then `migrate()` from `test-migrate.ts`) or it will silently hit the real `data/crowsnest.db`.
- **Channel Detail series (phase-1 final-review M8):** seed writes ZERO snapshot rows (only 2A's sync populates them). `ChannelDetail.series` MUST be built from the `videos` table (x = `postedAt`, y = `viewCount`, dot = `outlierScore`), NOT from `video_snapshots` — otherwise the chart is empty on seed data and Task 6's acceptance fails. Keep `medianViews`' snapshot-then-compute fallback as specced.
- **Headings (M6):** the topbar already renders the page's h1; page-level headings in content use h2 (avoid dual h1 per route).

---

### Task 1: Query layer

**Files:**
- Create: `src/server/queries/feed.ts`, `src/server/queries/channels.ts`, `src/server/queries/video.ts`, `src/server/queries/sync-status.ts`, `src/server/queries/feed.test.ts`, `src/server/queries/channels.test.ts`

**Interfaces (produces — every later task consumes these exact shapes):**

```ts
// feed.ts
export type FeedSort = "score" | "recent" | "views";
export interface FeedFilters {
  fleetId?: string; channelId?: string; platform?: "instagram" | "tiktok" | "youtube_shorts";
  minScore?: number; minViews?: number; sinceDays?: number;
  followerBand?: "nano" | "micro" | "mid" | "macro";
  sort: FeedSort; limit: number; offset: number;
}
export interface FeedItem {
  videoId: string; url: string; caption: string | null; thumbnailUrl: string | null;
  postedAt: string; durationSec: number | null; viewCount: number | null; outlierScore: number | null;
  channel: { id: string; handle: string; displayName: string | null; avatarUrl: string | null; followerCount: number | null; platform: string };
}
export async function getOutlierFeed(f: FeedFilters): Promise<{ items: FeedItem[]; total: number }>
export async function getSavedFilters(): Promise<{ id: string; name: string; isSystem: boolean; criteria: Record<string, unknown> }[]>

// channels.ts
export interface ChannelRow { id: string; handle: string; displayName: string | null; avatarUrl: string | null; platform: string; followerCount: number | null; medianViews: number | null; outliers30d: number; lastSyncedAt: string | null; syncError: string | null; fleets: { id: string; name: string }[] }
export async function getChannelsList(fleetId?: string): Promise<ChannelRow[]>
export async function getFleets(): Promise<{ id: string; name: string; channelCount: number }[]>
export interface ChannelDetail { channel: ChannelRow; stats: { medianViews: number | null; bestScore: number | null; outliers30d: number; videoCount: number }; series: { capturedAt: string; viewCount: number | null; outlierScore: number | null; videoId: string }[]; videos: FeedItem[] }
export async function getChannelDetail(id: string): Promise<ChannelDetail | null>

// video.ts
export interface VideoDetail { item: FeedItem; likeCount: number | null; commentCount: number | null; transcript: { text: string; source: string } | null; hasAnalysis: boolean }
export async function getVideoDetail(id: string): Promise<VideoDetail | null>

// sync-status.ts
export async function getSyncStatus(): Promise<{ status: "never" | "running" | "success" | "partial" | "failed"; finishedAt: string | null } | null>
```

- [ ] **Step 1:** Failing tests against in-memory DB + `seedDatabase` (phase-1 export): feed default sort=score returns planted 38.0× first; `minScore: 10` returns only ≥10 items; `sinceDays: 30` excludes older `postedAt`; `followerBand: "micro"` returns only channels 10K–100K; `fleetId` scopes correctly; `limit/offset` paginate with stable `total`; null-score videos excluded when `minScore` set but included (at end) in sort="recent". Channels: `getChannelsList` medianViews within seed expectations, `outliers30d` counts score ≥2 in last 30d; `getChannelDetail("nonexistent")` → null. 
- [ ] **Step 2:** Run → FAIL. Implement with Drizzle (`and/gte/inArray/desc` etc.); `medianViews` from latest `channel_snapshots` (fallback: compute via `computeChannelMedian` from phase 1); score sort = `outlierScore DESC NULLS LAST` (SQLite: `ORDER BY outlier_score IS NULL, outlier_score DESC`).
- [ ] **Step 3:** PASS → commit: `feat(queries): feed, channels, video, sync-status read layer`.

### Task 2: Format + heat utilities

**Files:**
- Create: `src/lib/format.ts`, `src/lib/format.test.ts`, `src/lib/heat.ts`, `src/lib/heat.test.ts`

**Interfaces:**
```ts
// format.ts
export function formatCompact(n: number | null): string      // 2400000→"2.4M", 45300→"45.3K", null→"—"
export function formatMultiplier(s: number | null): string   // 12.4→"12.4×", null→"—"
export function relativeTime(iso: string): string            // "3d ago", "2h ago", "just now"
export function formatDuration(sec: number | null): string   // 34→"0:34", 95→"1:35", null→""
// heat.ts
export type HeatTier = 0 | 1 | 2 | 3 | 4;                    // 0 = below 2× / null
export function heatTier(score: number | null): HeatTier     // [2,5)→1 [5,10)→2 [10,20)→3 ≥20→4
export function followerBandOf(count: number | null): "nano" | "micro" | "mid" | "macro" | null
```
- [ ] **Step 1:** Failing tests incl. boundaries (exactly 2, 5, 10, 20 → tiers 1,2,3,4; 1.9→0; null→0; 999→"999", 1000→"1K", 1_050_000→"1.1M"; band boundaries 10_000→micro, 100_000→mid, 1_000_000→macro).
- [ ] **Step 2:** Implement (Intl-free, deterministic; one decimal, trailing `.0` dropped). PASS → commit: `feat(lib): number/time formatting + heat tiers`.

### Task 3: OutlierBadge + OutlierCard components

**Files:**
- Create: `src/components/feed/outlier-badge.tsx`, `src/components/feed/outlier-card.tsx`, `src/components/feed/platform-chip.tsx`

**Interfaces:**
- Consumes: `FeedItem`, `heatTier`, format utils.
- Produces: `<OutlierBadge score={number|null} size="sm"|"lg" />`; `<OutlierCard item={FeedItem} variant="full"|"compact" onOpen?: (id)=>void />` (server-safe except click handling — card is a client component); `<PlatformChip platform={string} />` monochrome glyph per DESIGN.md §4.1.
- [ ] **Step 1:** Implement per DESIGN.md §5 anatomy exactly: 9:16 thumbnail area (`aspect-[9/16]`, fill `#1E2230`, centered play glyph, diagonal hatch via repeating-linear-gradient), badge top-right (tier styles verbatim §4.1 table — tier 1/2 translucent amber, tier 3 solid `#F5A524` dark text, tier 4 gradient + `shadow-[0_0_16px_rgba(255,90,26,.45)]`), platform chip top-left, duration pill bottom-right, channel row (24px Avatar + handle + follower micro-text), 2-line clamped caption, metrics row (eye + compact views · relativeTime), footer: bookmark icon button (disabled, tooltip "Vault arrives in phase 3"), secondary "Remix" button (links to `/feed/[id]/remix`), overflow menu (Copy link works via `navigator.clipboard`; "View on Instagram" external link). `compact` variant: no caption/footer (Dashboard + Channel Detail reuse).
- [ ] **Step 2:** `npm run build` green; visual smoke via dev server against `/feed` temp render (Task 4 owns the page — here mount card in a throwaway grid on the feed stub, kept only if Task 4 lands in same branch anyway). Commit: `feat(feed): outlier card, heat badge, platform chip`.

### Task 4: Outlier Feed page

**Files:**
- Create: `src/components/feed/filter-bar.tsx`, `src/components/feed/feed-grid.tsx`, `src/components/feed/quick-preview-sheet.tsx`, `src/components/feed/feed-list-row.tsx`
- Modify: `src/app/(shell)/feed/page.tsx`

**Interfaces:**
- Consumes: `getOutlierFeed`, `getSavedFilters`, `getFleets`, components from Task 3.
- Produces: `/feed?fleet=&platform=&minScore=&minViews=&since=&band=&sort=&view=` — **all filter state lives in URL search params** (server component reads them, filter bar is a client component pushing router.replace; back button and detail-return preserve state for free).
- [ ] **Step 1:** Page (server component): parse searchParams → `FeedFilters` (defaults: sort "score", limit 24, minScore from saved preset "Balanced" only when URL empty), fetch feed + fleets + saved filters, render filter bar + grid/list + result count. "Load more" = server-component pagination via `?offset=` links... **No** — use a small client wrapper with `useState` accumulating pages fetched through a route handler? Simplest robust: "Load more" is a `<Link>` that bumps `?limit=` by 24 (`limit=48`, `72`…), server re-renders full list, scroll preserved via `scroll={false}`. Implement that.
- [ ] **Step 2:** Filter bar per DESIGN.md §2.2 order: Fleet Select, platform ToggleGroup, score Select (Any/2×/5×/10×/20×), views Select (Any/10K/100K/500K/1M), timeframe Select (7/30/60/90d), band Select, saved-preset DropdownMenu (applies its criteria to URL), sort Select, grid/list ToggleGroup. Sticky under topbar (`sticky top-0 z-10 bg-background/95 backdrop-blur`).
- [ ] **Step 3:** Quick-preview Sheet (client): opens on card `onOpen`, right side ~440px: thumbnail, badge lg, metric chips, transcript excerpt (first 4 lines if `getVideoDetail` transcript exists — fetch lazily via a `"use server"` action **inside `src/server/queries/`** file `preview-action.ts` exporting `getVideoPreviewAction(id)`), buttons "Open full page" (→ `/feed/[id]`) + "Remix" (→ `/feed/[id]/remix`).
- [ ] **Step 4:** States per DESIGN.md §6: true-empty (no channels) vs filtered-zero ("Clear filters" resets URL) vs `loading.tsx` skeleton grid matching card shape exactly. List view: table-like rows (thumbnail 40px, badge, caption, channel, views, date).
- [ ] **Step 5:** Manual click-through on seed data: filters combine, presets apply, Sheet opens, load-more grows, list toggle works, empty states reachable (`?minScore=20&minViews=1000000&since=7`). `npm run build && npm test` → commit: `feat(feed): filterable outlier feed with quick preview`.

### Task 5: Channel Library + Add-channel dialog

**Files:**
- Create: `src/components/channels/channel-table.tsx`, `src/components/channels/fleet-rail.tsx`, `src/components/channels/add-channel-dialog.tsx`, `src/components/channels/sync-bridge.ts`
- Modify: `src/app/(shell)/channels/page.tsx`

**Interfaces:**
- `sync-bridge.ts` (THE only 2A seam — integration swaps its body):
```ts
export type BridgeResult = { ok: true } | { ok: false; error: string };
export async function bridgeAddChannel(handle: string, platform: string): Promise<BridgeResult>
export async function bridgeSyncChannel(channelId: string): Promise<BridgeResult>
export async function bridgeSyncAll(): Promise<BridgeResult>
export async function bridgeImportReel(url: string): Promise<BridgeResult>
// all stub-return { ok:false, error:"Sync engine lands with phase 2A — wired at integration" }
```
- [ ] **Step 1:** Page per DESIGN.md §2.3: fleet rail (180px; All channels pinned; counts; `?fleet=` param) + shadcn Table (avatar+handle, platform icon, followers, median views, outliers-30d, last synced w/ `syncError` warning icon + tooltip, row DropdownMenu: Sync now / View / Untrack-disabled-with-tooltip). Row click → `/channels/[id]`.
- [ ] **Step 2:** Add-channel Dialog: Tabs "By handle" (Input + platform Select) / "Paste reel URL" (Input) → calls bridge fns → `{ok:false}` renders the error string as an inline Alert (this is correct pre-integration behavior, user sees why). Toast (sonner) on `ok:true` path (post-integration).
- [ ] **Step 3:** "New fleet" dialog: **defer** — render the rail's `+ new fleet` item disabled with tooltip "Coming with Vault phase" (fleets exist via seed; creation UI is phase-3/4 polish; YAGNI now). Note in report.
- [ ] **Step 4:** Build + manual pass → commit: `feat(channels): library, fleet rail, add-channel dialog (bridged)`.

### Task 6: Channel Detail page

**Files:**
- Create: `src/components/channels/channel-header.tsx`, `src/components/channels/outlier-history-chart.tsx`
- Modify: `src/app/(shell)/channels/[channelId]/page.tsx`

- [ ] **Step 1:** Per DESIGN.md §2.3 detail block: header (48px avatar, handle, platform badge, followers, external link, Sync-now via bridge, Untrack disabled), 4 stat tiles (median views, best multiplier, outliers 30d, videos tracked) using a local `StatTile` component (label sentence-case, semibold compact value — dataviz stat-tile contract per DESIGN.md §5 notes).
- [ ] **Step 2:** Outlier-history chart per DESIGN.md §5 dataviz spec, no chart lib: inline SVG polyline — x = postedAt, y = viewCount of `ChannelDetail.series`; 2px `#767D93` line; points with `outlierScore ≥ 2` as ≥8px dots in tier heat colors with 2px `#12151C` ring; hairline gridlines; hover → Tooltip (date, views, multiplier); single direct label on max spike. Wrap in `overflow-x-auto`. Keep it a ~120-line client component; no recharts/d3.
- [ ] **Step 3:** Tabs: Recent Reels / Outliers Only / In Vault (disabled w/ tooltip "phase 3") — compact OutlierCard grids from `ChannelDetail.videos`.
- [ ] **Step 4:** Build + manual pass (all 4 seed channels render, chart dots match planted outliers) → commit: `feat(channels): detail page with outlier history chart`.

### Task 7: Video Detail shell + sidebar sync status

**Files:**
- Create: `src/components/video/video-detail.tsx`, `src/components/video/metric-chips.tsx`
- Modify: `src/app/(shell)/feed/[videoId]/page.tsx`, `src/components/layout/sidebar.tsx` (footer only)

- [ ] **Step 1:** Per DESIGN.md §2.4: left fixed ~380px column (9:16 poster div w/ play glyph, lg OutlierBadge, metric chips: views/likes/comments/engagement `(likes+comments)/views` as %, channel chip → channel page, posted date + platform, "View on Instagram ↗"), right Tabs: **Transcript** (from `VideoDetail.transcript`, scrollable ScrollArea; if null → quiet empty: "No transcript yet — transcription arrives with the phase-2A sync engine" when keyless, exact copy), **Hook & Structure** and **Why it worked** → placeholder Cards "AI analysis lands in phase 3". Actions: Save-to-Vault disabled+tooltip, Similar disabled+tooltip (phase 3), overflow: Copy link (works), Copy transcript (works when transcript exists), Copy as prompt disabled+tooltip. Sticky footer bar: primary "Remix this video →" → `/feed/[id]/remix` (stub page from phase 1). `generateMetadata`: title = caption first 40 chars + " · Crowsnest".
- [ ] **Step 2:** Sidebar footer: replace stub with `getSyncStatus()` render — dot color (muted "never", `#34D399` success, `#E8B23D` partial/running, `#F1585C` failed) + `relativeTime(finishedAt)` + refresh icon calling `bridgeSyncAll` (client island).
- [ ] **Step 3:** Full gate: `npm run build && npm test` green; click-through: feed → card → detail → back preserves filters; ⌘K → channels → detail → chart. Commit: `feat(video): detail shell + live sync status footer`.
