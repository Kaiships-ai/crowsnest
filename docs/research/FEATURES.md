# Sandcastles.ai — Feature Inventory (Research)

Researched 2026-07-23 by scout. Method: direct fetch of sandcastles.ai marketing site + blog changelog posts, plus ~15 secondary sources (reviews, competitor teardowns, help-doc search snapshots). See §7 for reliability notes — some claims are triangulated from secondary sources only, flagged inline.

## 1. Product overview & positioning

Sandcastles.ai (founder Kane Kallaway, 1M+ followers/1B+ views creator) is a **pre-production research and scriptwriting tool for short-form video creators** on Instagram, TikTok, and YouTube Shorts. Its pitch: "Create viral short-form videos in seconds — the easiest way to research top channels, find viral outliers, and remix them into your own winning videos." It explicitly stops at the script — no editing, rendering, voiceover, or publishing. Claims 100K+ creators/brands, 4.9/5 rating, 22K+ paying creators shortly after the v3 relaunch.

## 2. Feature inventory table

| Feature | What it does | UI surface | Priority |
|---|---|---|---|
| Watchlists | Group tracked creators into named, niche-specific collections; unlimited channels/watchlists | Channels tab | **must** |
| Add/search channel | Search any handle across IG/TikTok/YouTube; auto-populates if already in Sandcastles' DB, else "Submit new channel" request | Channels tab | **must** |
| Channel Filter | Deep-dive a single creator's whole catalog instead of a watchlist cohort | Channels tab search | **must** |
| Outlier detection / video database | Surfaces videos scored against the channel's own performance baseline ("outlier score"); "millions of videos analyzed daily" | Video tab (core feed) | **must** |
| Filters & sorting | Filter by watchlist, platform, outlier-score threshold, min view count, date range; sort by outlier score / views | Video tab | **must** |
| Saved Filters (presets) | Save a filter+sort combo as a reusable preset; ships two system defaults, "Sandcastles Default" and "Sandcastles Exceptional" | Video tab | **should** |
| Video detail page | Full transcript, hook breakdown, story-structure/format/style tags, performance stats, "why it worked" analysis | Video detail | **must** |
| Transcript extraction | One-click full transcript for any tracked video ("instantly download the transcript from any video") | Video detail | **must** |
| "More Like This" | Recommends other videos sharing storytelling pattern, not just keyword/topic match | Video detail | **should** |
| Copy-as-Prompt ("Create Prompt") | Packages topic + hook strategy + story structure + style notes + research facts into one paste-ready prompt for ChatGPT/Claude | Video detail action button | **must** |
| Vault | Personal library of hook/style templates extracted from any video via "Save to Vault" — the reusable-pattern store | Vault tab | **must** |
| Scriptwriter flow | Guided 5-step flow — Prompt → Research → Hook → Style → Script — composes a new script from a topic + vaulted hook + vaulted style in <60s | Scriptwriter | **must** |
| Live script editor | Google-Docs-style live editing, length controls, granular precision edits on the generated script | Script editor | **should** (v1 can be a plain editable draft; polish later) |
| Projects | Organize research/ideas/scripts per niche or channel; track iterations across strategies | Projects tab | **should** |
| Collections (editorial) | Sandcastles-curated, pre-analyzed video sets across 105+ items in 4 categories (Format, Editing Style, Visual Hooks, Signature Series); free to browse, no credit cost | Collections tab | **later** (requires an ongoing curation effort Sandcastles' own team does — not a v1 fit for a personal tool; own Vault/Boards substitute) |
| Search personalization | Learns per-account search/interaction patterns to bias future results toward the user's niche | background | **later** |
| Analytics Dashboard (own channel) | For your *own connected* account: views/followers over time, per-video highlighting vs. your last 8 posts | Dashboard | **later** (different job — post-publish analytics, not research/remix) |
| Content Strategist | Weekly automated report analyzing your last ≤50 own videos/channel for what's working vs. not | Dashboard | **later** |
| Content Success Formula | "Shuffle" widget suggesting new content "recipes" from your own winning elements | Dashboard | **later** |
| Diff Analysis | Compares successive Content Strategist reports to show trend shifts over time | Dashboard | **later** |
| AI Agents | Automates feed exploration (marketing copy only; no implementation detail found) | mentioned in pricing table | **later** |
| MCP integration (Claude/ChatGPT) | ~8 tools exposing outlier/format/analytics queries to an AI agent without leaving the chat | external integration | **later** (redundant with an in-app Claude API remix step per current plan) |
| API access | Build custom automations; Titan-tier only, marked "coming soon" on homepage | — | **out of scope** (no external consumers for a personal tool) |
| Workspaces + guest collaboration | Multiple brands/seats per account, invite collaborators (Visionary+ tier) | Settings | **out of scope** (solo user) |
| Credits system | Every research/analysis/generation action consumes 1 credit from a monthly pool | billing layer | **out of scope** (no monetization needed; could inform a soft usage cap on Claude API spend if desired) |
| Social account connection | Optional OAuth connect of own IG/TikTok/YT, only needed to power the Analytics Dashboard | Settings | **later** (gated behind Analytics Dashboard, itself later) |

Rendering/publishing: **confirmed out of scope for Sandcastles itself too** — a competitor teardown (Eden) specifically frames this as Sandcastles' limitation: "hands you a script and stops," "stops at video," no scheduling/publishing. This matches our own non-goal exactly.

## 3. Core UX flow, step by step

1. **Research a channel** — Channels tab → search a handle (auto-resolves if Sandcastles already tracks it, else submit a request) → add to a Watchlist, or use Channel Filter to inspect one creator alone.
2. **Browse outliers** — Video tab → pick a Watchlist (or single channel) → set filters: platform, outlier-score minimum (e.g. "5x"), min view count, date range → sort by outlier score or views, descending → optionally save this combo as a Saved Filter for reuse.
3. **Open a video** — click a result → detail page shows transcript, hook type, story-structure breakdown, format/style tags, and stats explaining *why* it likely went viral. From here: "Save to Vault" (hook and/or style), "Create Prompt" (copy-as-prompt export), or "More Like This" (similar-pattern videos).
4. **Remix into a script** — open Scriptwriter → **Prompt** (describe your topic/idea) → **Research** (pulls related outliers/facts) → **Hook** (auto-generates hook options from your Vaulted hook formats) → **Style** (applies a Vaulted style template to restructure the draft) → **Script** (live-editable output, length/precision controls) → target: viral-formatted script in under 60 seconds.
5. **Organize** — save the script and its source research into a Project, scoped to a niche or channel, to revisit and iterate later.
6. (Secondary loop) **Build the Vault over time** — every video worth remembering gets its hook/style extracted to the Vault independent of an immediate script need, so the Scriptwriter's Hook/Style steps have a growing personal library to draw from — this is what makes step 4 fast after the first few sessions.

## 4. Implied data model entities

- **Channel** — platform (IG/TikTok/YouTube), handle, follower count, avg views, tracked-since.
- **Watchlist** — name, niche label, list of Channel refs.
- **Video** — channel ref, platform post id/url, posted_at, view/like/comment counts, transcript text, computed outlier_score.
- **VideoAnalysis** — video ref; hook_type, story_structure, format_tags, style_tags, "why it worked" notes (this is what's shown on the video detail page and what gets extracted into Vault items).
- **VaultItem** — type (hook | style), source video ref, template text/pattern, tags, created_at.
- **SavedFilter** — name, criteria blob (watchlist ref, outlier_score_min, view_count_min, date_range, platform, sort order).
- **Project** — name, niche/channel scope, contains Scripts + research notes + linked Videos.
- **Script** — project ref, content (versioned/live-edited), source hook (Vault ref), source style (Vault ref), source video refs, status.
- **Collection** *(editorial, Sandcastles-owned — not user data; skip modeling for our clone)*.
- User/Workspace/Credit-ledger entities exist in Sandcastles but are **not applicable** to a single-user local tool (no billing, no seats).

This maps closely to the entities already sketched in `docs/PLAN.md` (Channel, Video, Board→Vault/Project, RemixTemplate→VaultItem, Script) — no surprises, mostly confirms naming.

## 5. Pricing tiers & what they gate

| Plan | Monthly | Annual (effective /mo) | Channels tracked | Credits/mo |
|---|---|---|---|---|
| Pro | $49 | $39 | 50 | 100 (official site) |
| Visionary | $99 | $79 | 100 | 250 (official site) |
| Titan | $499 | $399 | 1,000 | 1,500 (official site) |

(Channel caps are from secondary sources — creatoreconomytools and the Eden competitor teardown independently agree on 50/100/1,000 — not stated on the official pricing block itself, flagged as secondary-only. One aggregator, ColdIQ, reports very different credit counts — 500/1,500/10,000 — that don't match the official site or match each other's ratio; treating the official homepage figures as authoritative and ColdIQ as unreliable/stale.)

**Key finding for prioritization:** the tier ladder gates *scale and collaboration*, not *features*. Watchlists, outlier detection, transcripts, Vault, and the full Scriptwriter flow are all available on the base $49/mo (**$39/mo annual**) Pro plan — the entire core research→remix loop this clone targets. Visionary adds more channels/credits + workspace guests; Titan adds API access + higher limits + Slack support. Nothing in our "must" list is a higher-tier-only feature on the real product — which is a strong signal we're scoping the clone's v1 correctly around the base-tier feature set.

Credits: "every action costs 1 credit" (research, analysis, hook generation, script writing all draw from the same pool) — a usage-metering pattern worth borrowing conceptually if Kai wants to cap Claude API spend, even with no billing UI.

## 6. Sources

Primary (official):
- https://www.sandcastles.ai/ (home + #features/#how-it-works/#pricing/#faq anchors) — fetched directly
- https://blog.sandcastles.ai/ — fetched directly (post index)
- https://blog.sandcastles.ai/p/vaultlaunch — "Introducing Sandcastles 3.2" — fetched directly
- https://blog.sandcastles.ai/p/newreleases-091425 — "5 new features for finding viral outlier ideas" — fetched directly
- https://blog.sandcastles.ai/p/dashboard — Analytics Dashboard — fetched directly
- https://blog.sandcastles.ai/p/collections — Collections — fetched directly
- https://www.content.game/p/sandcastles-v3launch — founder's own v3 launch post — fetched directly

Help center (Notion-hosted; blocked direct fetch — JS shell only — content recovered via search-engine cached snapshots, so these are secondhand quotes, not directly verified rendering):
- https://help.sandcastles.ai/Building-Watchlists-295acc48f1da81179854fd95373f95cc
- https://help.sandcastles.ai/Saving-Hooks-and-Styles-to-the-Vault-295acc48f1da80d08da3ec1fabfbee7d
- https://help.sandcastles.ai/Video-Tab-Filters-Sorting-295acc48f1da8104800ce70e95ed4327
- https://help.sandcastles.ai/Understanding-the-Vault-295acc48f1da805a865ddeecdb1f68de
- https://help.sandcastles.ai/Generating-Scripts-295acc48f1da80ff8388e79735aede86
- https://help.sandcastles.ai/Adding-New-Channels-295acc48f1da81f691a6c7d3092de2c2

Secondary (reviews / comparisons / directories):
- https://creatoreconomytools.com/tool/sandcastles-ai
- https://ecom-tools.de/en/sandcastles-ai/
- https://coldiq.com/tools/sandcastles
- https://eden.so/vs/sandcastles/ (competitor teardown — useful for limitations)
- https://www.stayhypd.com/blog/sandcastles-mcp-claude
- https://creatoreconomytools.com/alternatives/sandcastles-ai
- https://www.octupie.com/blog/best-sandcastles-ai-alternatives-2026
- https://formatfinder.onepeakcreative.com/resources/compare/format-finder-vs-sandcastles-ai (not fetched in full — title/summary only)
- https://www.youtube.com/watch?v=oN8eZH1ANy8 — "Watch This BEFORE Getting Sandcastles AI – Honest Review" (not watched — see §7)

## 7. Reliability notes / gaps

- **Official site is reachable and rich** — the #features/#pricing/#faq content lives on the single homepage (confirmed via direct fetch); `/pricing` as a standalone path 404s, it's an anchor not a route.
- **help.sandcastles.ai (Notion-hosted) blocks WebFetch** — every direct fetch returned only the literal string "Notion" (client-rendered SPA shell, no server-side content). I recovered article content via WebSearch's cached snapshots instead, which is why those citations quote synthesized search summaries rather than raw page text. If exact UI copy matters later, these pages need a JS-rendering fetch (headless browser) to verify verbatim.
- **Numeric conflicts across secondary sources** are flagged inline in §5 (channel caps, credit counts) — official homepage numbers used as ground truth where they exist.
- **Did not invoke the watch:watch skill on the YouTube review** — fetch + search converged on a consistent, detailed picture of the UI (watchlists, video tab filters, vault, scriptwriter steps all corroborated across ≥2 independent sources each), so per the optional/skip guidance I stopped here rather than spending more time on video-frame extraction. If the leader wants pixel-level UI layout (exact button placement, colors, information density) rather than functional behavior, that video is the next thing to pull.
- No feature above was invented without a source; anything with only one weak source is marked "later" rather than "must" to keep the priority column conservative.
