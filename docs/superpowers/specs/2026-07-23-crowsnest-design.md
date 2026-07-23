# Crowsnest — Design Spec (v1)

Date: 2026-07-23 · Author: team leader (synthesis of phase-0 research)
Working name: **Crowsnest** (pending Kai's pick; find-replace safe).

## 1. What we're building

A personal-use, local-first clone of sandcastles.ai's core loop for Kai (kaiships.ai):

> track short-form channels → surface viral **outliers** (views ÷ channel median) → study **why** they worked → **remix** their hook/structure into scripts for Kai's niche → export to `ksa-content-machine` (which renders + publishes)

Single user, runs on Kai's Mac (`npm run dev`), no auth, no billing, no hosting. Target running cost ~$0–25/mo (Apify usage + Claude API pennies; keyless demo mode works with $0).

## 2. Source documents + precedence

| Doc | Owns |
|---|---|
| `docs/research/FEATURES.md` (scout) | What the real product does; feature priorities |
| `docs/research/DATA.md` (datascout) | Data acquisition, `SocialProvider`/`TranscriptProvider` interfaces (§3), sync strategy (§5) — **implement these interfaces verbatim** |
| `docs/design/DESIGN.md` (designer) | Visual system: tokens (§4, incl. paste-ready globals.css), shell, page layouts, card anatomy (§5), states (§6) |
| This spec | Scope, architecture, data model, conflict resolution, phases |

**Conflict rule: this spec wins.** Known stale sections in DESIGN.md (designer's session dropped mid-revision): §2.5 body (old two-pane Remix), §2.6 header/body ("Boards"), stray "board/Boards" strings in §2.1 KPI tile, §2.3 tabs, §2.4 actions, §5 footer actions. Canonical resolution: **Vault** (not Boards) per §6 below; **Remix Studio = 5-stage pipeline** per §7 below. All other DESIGN.md content stands. (Phase-4 task: reconcile DESIGN.md itself.)

## 3. v1 scope

Everything scout marked **must** (= the entire paid $49/mo value of the real product):

1. **Fleets** (channel watchlists): add/search channel by handle or pasted URL, group into named Fleets, a channel can be in multiple Fleets
2. **Sync**: weekly-capable manual sync (cron optional, off by default) — profiles first, then latest ~30 reels/channel; upsert counts; provider fallback chain
3. **Outlier Feed**: filter by Fleet / platform / min outlier score / min views / timeframe / follower band; sort by score, recency, views; two shipped saved-filter presets ("Balanced" 5×+/30d, "High Conviction" 10×+/14d/500K+); quick-preview Sheet; grid + list views
4. **Video Detail**: metrics, full transcript, Hook & Structure breakdown, "Why it worked" analysis, Similar outliers, **Copy as Prompt** export
5. **Vault**: save hook/style templates extracted from any analyzed video; manual template entry; Scripts tab
6. **Remix Studio**: staged Prompt → Research → Hook → Style → Script; pulls Vault templates; editable output; save script
7. **Dashboard**: KPI tiles, today's top outliers, fleets-with-spikes, recently viewed
8. **Settings**: niche profile (feeds remix context), API-key status + test buttons, sync preferences

**Should (in v1 if cheap, else backlog):** Saved custom filters beyond the 2 presets; script length controls.
**Non-goals v1:** rendering/publishing (ksa-content-machine), own-channel analytics, Collections (editorial curation), search personalization, MCP/API access, multi-seat, credits/billing, light mode, mobile, TikTok/YT Shorts providers (interface supports them; not wired).

## 4. Architecture

```
Next.js 15 App Router (TS, single process)
├─ app/                     routes per DESIGN.md §1 IA (with /vault)
├─ src/server/db            Drizzle + better-sqlite3 (file: data/crowsnest.db)
├─ src/server/providers     SocialProvider impls: apify (primary), hikerapi (fallback),
│                           ytdlp (keyless single-URL escape)   [DATA.md §3 interface]
├─ src/server/transcribe    TranscriptProvider impls: whispercpp (primary), groq (fallback)
├─ src/server/services
│   ├─ sync-engine          orchestrates sync per DATA.md §5 (fallback chain, upsert, gaps)
│   ├─ outlier-calc         score = viewCount ÷ trailing median of channel's last 20 videos
│   │                       (same-pass medians; recompute whole channel on each sync;
│   │                       <20 videos → median over what exists; <5 videos or median 0
│   │                       → score null, badge "—", excluded from outlier filters)
│   ├─ analyze              Claude → VideoAnalysis (hook type, structure segments, format/
│   │                       style tags, why-it-worked). On-demand at first Video Detail
│   │                       open, cached in DB forever (cost control — no bulk analysis)
│   ├─ remix                staged generation engine (§7)
│   ├─ similar              "Similar outliers": rank tracked videos by shared analysis tags
│   │                       (hook type + structure + format overlap), local only, no ML
│   └─ export               Copy-as-Prompt builder (§8)
└─ server actions           thin wrappers; all logic in services (testable without HTTP)
```

- Long-running work (sync, transcribe, analyze, remix) runs in server actions with streamed/polled progress into the UI (sidebar sync status; per-variant progress in Remix). No queue infra — SQLite `sync_jobs` rows + in-process execution is enough for one user.
- yt-dlp + whisper.cpp are external binaries: detected at startup, Settings shows install state; `scripts/setup-local.sh` installs via Homebrew + downloads `large-v3-turbo` model.
- Keyless mode: seeded demo data + yt-dlp manual URL import + local whisper all work with zero keys. Apify sync and Claude analysis/remix surface a "key missing" Alert (DESIGN.md §6) instead of erroring.

## 5. Data model (Drizzle tables)

`channels` (id, platform, handle, externalId, displayName, avatarUrl, followerCount, followingCount, mediaCount, bio, isVerified, trackedSince, lastSyncedAt) ·
`fleets` (id, name, nicheLabel) · `fleet_channels` (fleetId, channelId) ·
`videos` (id, channelId, platform, externalId UNIQUE(platform,externalId), url, caption, postedAt, durationSec, thumbnailUrl, videoUrl, viewCount, likeCount, commentCount, shareCount, outlierScore REAL, firstSeenAt, lastRefreshedAt) ·
`channel_snapshots` (channelId, capturedAt, followerCount, medianViews) ·
`video_snapshots` (videoId, capturedAt, viewCount, likeCount, commentCount) ·
`transcripts` (videoId PK, text, language, durationSec, source: whisper-local|groq|caption) ·
`video_analyses` (videoId PK, hookType, structureSegments JSON [{label,startSec,endSec,note}], formatTags JSON, styleTags JSON, whyItWorked, model, createdAt) ·
`vault_items` (id, type: hook|style, sourceVideoId NULL, title, templateText, tags JSON, createdAt) ·
`scripts` (id, title, content, sourceVideoId, hookVaultItemId, styleVaultItemId, status: draft|final, createdAt, updatedAt) ·
`saved_filters` (id, name, criteria JSON, isSystem) ·
`remix_sessions` (id, sourceVideoId, stage, topic, niche, researchNotes JSON, hookOptions JSON, chosenHook, outline, variants JSON, createdAt, updatedAt) ·
`sync_jobs` (id, startedAt, finishedAt, status, stats JSON, gaps JSON) ·
`app_settings` (key PK, value) — niche profile, sync prefs. **API keys live in `.env.local` only, never in DB**; Settings shows presence + test result.

Snapshots power Dashboard sparklines + Channel Detail outlier-history chart; medians always computed from same-sync-pass data (DATA.md §5.7).

## 6. Vault (canonical, replaces DESIGN.md "Boards")

- Route `/vault`. Tabs: **Hooks** / **Styles** / **Scripts**.
- Hook/Style cards: title, template text (the reusable pattern, e.g. hook formula with `{topic}` slots), tags, source-video chip (→ Video Detail), "Use in Remix" action.
- Sources into Vault: (a) Video Detail → "Save to Vault" picks hook and/or style extracted from `video_analyses`, prefilled + editable before save; (b) Remix Studio Hook/Style stages ("save this hook as template"); (c) manual New-template Dialog.
- Terminology sweep: every stale "board" string in DESIGN.md maps to Vault ("Save to board" → "Save to Vault", Dashboard KPI "Boarded this wk" → "Vaulted this wk", Channel Detail tab "In Boards" → "In Vault", Remix "Send to board" → "Save script").

## 7. Remix Studio (canonical staged pipeline)

Route `/feed/:videoId/remix`. Persistent left context rail (collapsed source summary: thumbnail, multiplier, channel, transcript access). Main area = 5-step stepper (visible progress, back/forward free, state persisted in `remix_sessions`):

1. **Prompt** — topic input (prefilled suggestion from source video's topic transplanted to Kai's niche), niche pulled from Settings, target length select (30/45/60/90s)
2. **Research** — auto-assembled context, editable: source video's analysis + transcript, top 5 similar tracked outliers (via `similar` service), free-text facts box. No web search in v1.
3. **Hook** — 5 generated hook options. Generator uses: chosen Vault hook template if selected, else source video's hook pattern. Each option: use / edit / save-to-Vault
4. **Style** — pick structure: source video's structure (default) or a Vault style template → generates beat outline (editable)
5. **Script** — generates N variants (default 3) as tabs, each editable Textarea + regenerate-this-variant + copy; per-variant failure shows inline Alert + retry, successes untouched (DESIGN.md §6). Save → `scripts` (+ optional Vault)

**Quick Remix** button on step 1 runs all stages with defaults end-to-end (the <60s path); lands on step 5 with everything back-editable.

**Claude API:** `@anthropic-ai/sdk`, default model `claude-sonnet-5` (env `CLAUDE_MODEL` override). One call per stage action (hooks batch = 1 call; each script variant = 1 call, parallel). Analysis (§4 `analyze`) = 1 call per video, cached. Prompt templates live in `src/server/services/remix/prompts/` as versioned TS files — editable without redeploy. Builder must invoke the `claude-api` skill before writing SDK code.

## 8. Copy-as-Prompt export

One structured markdown block: topic framing, hook strategy, structure beats, style notes, research facts, source metrics — paste-ready for any LLM (mirrors the real product's "Create Prompt"). Locations: Video Detail overflow + Script view. v2 hook: write directly into `ksa-content-machine`'s input format (out of v1 — needs its format spec first).

## 9. Error handling

- Sync: per-channel try Apify → HikerAPI → record gap in `sync_jobs.gaps`; never fail the whole run on one channel. 429/5xx: exponential backoff, small concurrency pool (3–5), jitter (DATA.md §5)
- Handle renamed/private/deleted: mark channel `syncError`, surface on Channels table row + Dashboard, don't retry-loop
- Provider returns `viewCount: null`: store row, exclude from outlier math, badge shows "—"
- Missing binaries (yt-dlp/whisper.cpp) or keys: feature-level Alerts + Settings test buttons; never crash a page
- Claude failures: per-variant/per-stage inline retry; analysis failure → detail page still renders transcript + metrics

## 10. Testing

- **Vitest** on services, TDD where math/mapping is the point: `outlier-calc` (medians, edge cases: <5 videos, null views, zero median), provider response mappers (fixture JSON from real Apify/HikerAPI/yt-dlp payloads), `similar` ranking, Copy-as-Prompt builder, remix prompt assembly (snapshot tests)
- Providers/Claude behind interfaces → fake implementations for tests; no live API calls in CI
- UI: no e2e framework in v1; scripted QA pass (browse skill) at phase gates 2/3/4 against seeded demo data
- Seed script: 4 fake channels, ~80 videos with realistic long-tail view distributions (so the Feed/outlier math demos meaningfully keyless), 6 vault items, 2 scripts

## 11. Build phases (each gated by cavecrew-reviewer pass)

| # | Scope | Agents |
|---|---|---|
| 1 | git init + Next.js scaffold, Tailwind v4 + shadcn, tokens from DESIGN.md §4.4, Drizzle schema + migrations + seed, app shell (sidebar/topbar/⌘K stub), commit docs | 1 builder |
| 2A ∥ 2B | **2A:** providers (apify/hikerapi/ytdlp) + transcribe + sync-engine + outlier-calc + snapshots (services + tests only) · **2B:** Feed (filters/cards/Sheet/list) + Channels + Video Detail shell on seed data | 2 builders parallel (2A never touches `app/`, 2B never touches `src/server/{providers,transcribe,services/sync*}`) |
| 3 | analyze + similar + Remix Studio stepper + Vault + Copy-as-Prompt | 1 builder |
| 4 | Dashboard + Settings + polish, DESIGN.md reconciliation, palette validator re-run (DESIGN.md §4.1 note), QA + fixes | builder + qa |

## 12. Open items

- Name: Kai picks (Crowsnest ★ / Riptide / Spyglass)
- Apify actor IDs + real payload fixtures: builder 2A verifies exact field names on first live call (datascout flagged pricing/fields drift)
- `ksa-content-machine` export format (v2)
- Palette validator (`validate_palette.js`) re-run once Node env exists (phase 4)
