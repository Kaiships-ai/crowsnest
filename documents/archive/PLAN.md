# Sandcastle Clone — Master Plan (DRAFT v0.1 — 2026-07-23)

Status: **Phase 0 complete — ON HOLD awaiting Kai** (2026-07-23). Delivered: `docs/research/FEATURES.md`, `docs/research/DATA.md`, `docs/design/DESIGN.md` + `docs/design/mock-outliers.html` (open in browser to judge direction). Next on return: leader synthesizes spec to `docs/superpowers/specs/`, Kai approves design + name, then Phase 1 builders.

## Goal

Personal-use clone of the sandcastles.ai core loop:

> track top short-form channels → surface viral **outlier** reels → AI-**remix** them into scripts for my niche (kaiships.ai)

Target user: Kai, solo. Target cost: ~$0/mo (local-first, no hosting). Feeds the existing `ksa-content-machine` pipeline (which already renders + publishes) — so **this tool stops at the script**.

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Stack | Next.js 16 (App Router, TS) + Tailwind + shadcn/ui | Kai already ships Next.js; fastest path. (Plan said 15; `create-next-app@latest` delivered 16.2.11 — accepted 2026-07-23) |
| DB | SQLite (better-sqlite3) + Drizzle ORM | Local file, zero cost, no server |
| Runtime | Local-first (`npm run dev` on Mac) | $0/mo constraint; deploy optional later |
| AI remix | Claude API, default `claude-sonnet-5` | Quality/cost balance; key via `ANTHROPIC_API_KEY` |
| Data layer | **instagrapi** via a local Python sidecar (`services/ig/`), **yt-dlp** keyless manual escape. *(Superseded 2026-07-26 — was: Apify primary, HikerAPI fallback)* | Official Graph API disqualified: cannot enumerate other creators' media. Vendor route dropped at Kai's direction — see the reversal note below |
| Transcripts | **whisper.cpp + Metal** local (large-v3-turbo, ~3-6s per 60s reel, free); Groq Whisper API fallback | Free + fast on Apple Silicon; faster-whisper skipped (no Metal) |
| Outlier score | views ÷ trailing median views of channel's last ~20 posts | Sandcastles' core metric, simple + robust |
| Branding | Original, dark-only UI. Working name **Crowsnest** (designer rec; alts: Riptide, Spyglass) — Kai confirms | Clone features, not brand; nautical nod to kaiships |
| Platform priority | Instagram Reels first | 100k IG goal; TikTok/Shorts later behind same interface |

## Core features (v1 hypothesis — scout validates)

Scout confirmed (2026-07-23): full research→remix loop sits on the base $49/mo tier — tiers gate scale (channel caps, credits, seats), not features. V1 scope below = the whole paid value.

1. **Watchlists** — add/watch channels in niche, profile stats, manual + scheduled sync
2. **Outlier feed** — video tab with outlier-score filter + sort, filterable cards (multiplier, timeframe, follower band), the hero surface
3. **Video detail** — metrics, transcript, hook/structure breakdown
4. **Vault** — save extracted hook/style templates from any video. Scout: this is the real differentiator (reuse engine that makes remixing fast after first sessions) — prioritize over script-editor polish
5. **Scriptwriter** — staged pipeline: Prompt → Research → Hook → Style → Script (<60s target); pulls Vault templates; editable prompts
6. **Create-Prompt export** — copy any video/script as a structured prompt; hands off to ksa-content-machine

Non-goals v1: rendering, auto-posting, scheduling (ksa-content-machine owns these), own-channel analytics dashboard (post-publish job — Sandcastles has one, marked later), teams, billing, mobile.

## Architecture sketch

- Next.js app → server actions → services: `sync-engine`, `outlier-calc`, `remix-service`, `transcript-service`
- `SocialProvider` interface isolates data acquisition (impl per datascout recommendation + manual URL-import fallback so app works keyless)
- Transcripts: the locally stored mp4 asset (downloaded by the sidecar, else yt-dlp) → whisper.cpp Metal (large-v3-turbo); Groq API fallback
- Entities: Channel, Video, MetricSnapshot, Transcript, Board, BoardItem, RemixTemplate, Script, SyncJob

## Phases

| # | Phase | Who | Gate |
|---|---|---|---|
| 0 | Research + design — **done 2026-07-23** | scout, datascout, designer | ON HOLD → spec synthesis + Kai's design approval |
| 1 | Scaffold: repo, Next+shadcn+Drizzle, schema, seed data, shell | 1 builder | reviewer pass |
| 2 | Data pipeline (provider, sync, outlier calc) ∥ UI (channels, outlier feed, video detail) | 2 builders parallel | reviewer + integration |
| 3 | Scriptwriter + Vault + transcript pipeline | 1 builder | reviewer pass |
| 4 | Create-Prompt export + polish + QA | builder + qa | full QA (browse) |

## Team

Leader (this session): plan, dispatch, integrate, review gates. Teammates: `scout` (product research), `datascout` (data acquisition research), `designer` (design spec + mock) — running. Later: builders per phase, `reviewer` (cavecrew-reviewer on diffs), `qa`.

## Open questions (phase 0 answers)

- ~~Data route~~ — **REVERSED 2026-07-26.** The original answer was Apify primary / HikerAPI fallback, explicitly rejecting "self-hosted instagrapi with a real account" because of confirmed ban reports even behind paid proxies. Kai directed the opposite trade: replace the paid vendors entirely with instagrapi. The ban risk that argument was built on is real and has **not** gone away — it is now accepted, disclosed in the README, and mitigated (throwaway account, persistent session, pinned device, jittered pacing, backoff, optional proxy) rather than outsourced. Cost drops to $0; the risk moves onto an Instagram account we control. Later platforms: TikTok/YouTube Shorts still need their own source — the `platform` column and `SocialProvider` shape remain for that.
- ~~Transcripts~~ — answered: whisper.cpp Metal local primary, Groq hosted fallback
- ~~Missing loop-critical features~~ — answered by scout: Vault + staged Scriptwriter were the misses, now in v1; exact channel caps per tier remain secondary-source-only (irrelevant to us)

## Setup Kai provides later

- `IG_SERVICE_TOKEN` + `IG_USERNAME`/`IG_PASSWORD` (channel sync, free) · `ANTHROPIC_API_KEY` (remix) · optional `GROQ_API_KEY` (transcript fallback) · full schema in `.env.example`
- Keyless still works: demo seed data + yt-dlp manual reel import + local whisper.
