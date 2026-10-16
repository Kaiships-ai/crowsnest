# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: a **solo content creator** growing their own Instagram, working alone on
their own Mac. They install crowsnest once from a terminal, then run it as a local desktop
app in the browser. They care about knowing what to make next, low setup friction, and
speed. They are not an agency or a team; there is one operator, one machine, one vault, one
license seat. There are no roles, plans, or second users.

The buyer of the Kit is the same persona: another solo creator who wants the same daily
habit on their own channel. Open the app in the morning, see which watched posts beat their
own channel overnight, read why one worked, and turn it into the next post.

## The problem

Knowing what already works on other channels means opening a dozen competitor and reference
accounts, scrolling for anything that beat that account's usual numbers, working out why, and
rebuilding it in your own voice. Nothing in that habit is saved, compared, or repeatable.
Two problems follow, and they are the two halves crowsnest replaces:

1. **Finding the outlier is a scanning problem.** A raw view count means little. What matters
   is whether a post beat its own account's baseline, so crowsnest scores every tracked post
   as a multiplier of the channel's median and ranks the feed on it.
2. **Turning it into a script is a rebuilding problem.** Rebuilding a post's hook, structure,
   and pacing in your own voice is slow and easy to skip. The remix studio takes one source
   video through research, hook, style, script, and finish, and produces a script and a
   planned post.

A research tool that shows a number the user cannot trust is worthless. A value the app does
not have renders as a dash, never a fabricated zero.

## Product Purpose

crowsnest watches a handful of Instagram channels a creator competes with and scores every
post against that channel's own median, so the creator sees what genuinely over-performed
rather than what is merely popular. It then carries that signal all the way through: spot an
over-performer in the feed, analyze it, save it to a vault, remix it into the creator's own
version, plan it on a calendar, hand it off through the MCP server to Reel Factory to
produce, and schedule or publish the finished Reel straight to their own Instagram channel
through the Graph API. Success is the creator consistently shipping posts informed by what
actually beats the median in their niche.

## Positioning

The durable differentiator to protect is the **full feed to remix loop in one tool**, with a
clean handoff to production, not analytics alone. A neighboring product can show competitor
metrics; crowsnest takes the creator from spotting an over-performing post to a finished
remix, then hands off through its MCP server to Reel Factory, which produces the video. It
decides what to make and writes the script and the brief; it does not render video. The
median-relative scoring (a nano account beating its own median reads as loud as a viral hit)
and the local-and-private posture (runs alone on the buyer's Mac, Instagram read through a
local sidecar, data never leaves the machine) are core supporting mechanisms, but the
end-to-end loop is the thing every future decision must keep whole.

## Operating Context

- Installed and run on the buyer's own Mac (**Apple Silicon only**). The dashboard runs
  locally at `localhost:3000`; there is no hosted/cloud version and no account to sign into.
- Setup is a terminal step, `kai kit init`, run after `kai login <license>`; it writes
  `.env.local`, creates the local sqlite database, and starts the app.
- Instagram data is read through a **local Instagram sidecar** (instagrapi) that the app
  signs into using a throwaway account's session. This sign-in is the "read key" that every
  channel-watch and every sync depends on. Read-only; nothing is posted through it.
- Background services run under **launchd** and survive a reboot; `kai` CLI manages the
  lifecycle (`login`, `kit init`, `up`, `start`, `stop`, `status`, `doctor`, `update`, `rollback`,
  `mcp`). `kai mcp` registers the MCP server with Claude Code and Codex.
- Distributed as the **$99 Kit**, a one-time purchase with no subscription, with a Polar
  license gate checked before the tarball is served and again by size/checksum after
  download. The Kit bundles its own Node, Python, and package manager. The buyer-facing
  install guide is `packaging/buyer-quickstart.md`.
- The in-app **first-run flow** (`/first-run`) takes a fresh install to a tracked channel
  and a first sync: FOCUS, INSTAGRAM (the read key), CHANNELS, FIRST SYNC.

## Actors

- **The buyer.** The single human. Every action in the loop is theirs: browse the feed, analyze,
  remix, plan, hand off, publish.
- **The app.** The Next.js surface under `src/app/(shell)`, its server actions and queries, and
  the local database. Its outer edge is an MCP server at `/api/mcp` that owns no tables and
  projects what the feed, remix, and planner already store.
- **The IG sidecar.** A local service over localhost that fetches posts from tracked channels
  and is the only writer of the feed's contents. Started by the Kit, not hosted by crowsnest.
- **The agent.** Claude (or any MCP client) writes the analysis and the remix hook, outline,
  and script over MCP. The app makes no model call and needs no model key.
- **Instagram Graph API.** The official, token-gated path used for the buyer's own channel
  metrics and for publishing. Never used for tracked-channel fetching.
- **Polar.** The license vendor. Checked at install and at `kai kit init`, not on every run.

## Capabilities and Constraints

- Core loop is built and runs: sync, feed and filters, video detail + analysis, save to
  vault, the six-stage remix studio, and calendar and plan dialog. The
  finished remix hands off through the MCP server to Reel Factory, which produces the video.
  Scheduled and immediate publish to the creator's own channel is built on the Graph API,
  dry-run by default outside production; a live publish needs a configured S3-compatible
  bucket, a Graph API token, and a Business or Creator Instagram account (Reels publish
  requires one).
- Discover (`/channels/discover`) is built and runs: a curated, niche-grouped list of real
  Instagram creators (fitness, finance, tech, business) with a one-line, metric-free reason
  for each. Follow is one click, reusing the same add-channel and start-sync path a manual
  add uses; no follower or view count is shown for a creator that has not been followed and
  synced.
- Degradation contract: a missing service removes only the step that needs it. With the sidecar not running, no new videos arrive and the feed
  goes stale instead of erroring. With the Graph token invalid, only own-channel metrics are
  unavailable. With no own channel set, the dashboard asks for one.
- Constraints future work must respect: Apple Silicon only; single-user local install; local
  sqlite (`data/crowsnest.db`, plaintext secrets, never returned to the browser); Instagram
  access is read-only and depends on a running local sidecar logged into a throwaway account
  (no sidecar / no read key means no sync).
- This is not the stock Next.js. APIs, conventions, and file structure diverge; a custom
  `tsx server.ts` fronts the app, with a Python sidecar under `services/ig/`.
- Terminology to keep consistent: **read key** (the throwaway-account Instagram session),
  **channel** (a watched competitor account), **sync**, **vault**, **remix**.
- The MCP server at `/api/mcp` exposes 30 tools. Crowsnest holds the data and actions and the
  connected agent is the only reasoning brain, so the full workflow (sync, inspect, save an
  analysis, remix, brief) runs with no model key. A brief returned over MCP carries local
  file paths for the video and thumbnail. Transcription needs whisper.cpp locally or `GROQ_API_KEY`.
- Sync can be cancelled, run for selected channels, and put on an automatic cadence in Settings
  (0 is off). Several burner accounts can be added and channels stick to one; one account's
  cooldown does not stop the others, but live parallel traffic across accounts is not built.
- Own-channel numbers come from the official Graph API with a token set in Settings. Own reels
  are measured automatically while the app runs, hourly for the first 72 hours and daily after,
  and "Measure now" runs it on demand. Insights can lag Instagram by up to 48 hours.
- Publish: uploads are mp4 only, up to 200 MB, captions up to 2200 characters. A transient
  failure retries automatically up to 3 attempts. A missing bucket or Graph token disables the
  action and names the missing variables.
- Instagram sign-in is validated against a live login before anything is saved.
- Out of scope: Intel Macs, Windows, Linux, and platforms other than Instagram. The `platform`
  column stays in the schema so a later platform is additive.
- Open product facts (do not fabricate): end-to-end verification on a real buyer's machine
  with real credentials is still open.
  Nothing in the sources states a compliance posture for scraping reference channels through
  the sidecar; that question is open and no answer is invented here. No market-size figure is
  claimed.

## Use cases

The loop as the buyer runs it. Detail per part lives in `documents/architecture/`, and per-component features and test cases in `scripts/e2e/cases/`.

| Use case | What happens | Rules |
| --- | --- | --- |
| Track a channel | Add a handle on `/channels` (or follow from Discover). Exactly one channel can be marked own; the rest are competitors or references. | The next sync picks the channel up. Setting a new own channel demotes the old one. |
| Sync | The sidecar reads a 30-day lookback per tracked channel, at most 200 items per run, with 3 retries per upstream call, and writes new videos scored against the channel's own baseline. | Runs in the background and never blocks the buyer. Defaults are env settings (`LOOKBACK_DAYS`, `MAX_ITEMS_PER_SYNC`, `SYNC_MAX_RETRIES` in `src/server/config.ts`). A failure surfaces in the shell failure strip on the next navigation. A video that vanishes from Instagram is soft-removed (`videos.deletedAt`): it stays in the feed marked "No longer on Instagram", and its saved and planned posts stay. |
| Analyze | The agent reads a video through `crowsnest_video` and writes hook type, structure beats, format and style tags, and a why-it-worked note through `crowsnest_save_analysis`. The detail page shows it on the next load. | No model key. The row is written whole or not at all. Save to vault and remix need an analysis first. |
| Remix | Six stages in order: prompt, research (local), hook, style, script, finish. The app makes no model call. Hook, style, and script show what the agent wrote over MCP, each with a Copy prompt for Claude button that copies that stage's MCP steps. | Autosaved and server-backed; leaving resumes at the furthest stage. New agent text appears after a reload. Finish is idempotent and creates one undated draft planned post carrying the script. |
| Hand off and publish | Reel Factory (any MCP client) calls the read tools at `/api/mcp` to pull the planned post, its script, and the source video's local media path, then produces the reel outside crowsnest. The creator schedules or publishes it to their own channel through the Graph API, or marks the plan published by hand. | Registered once with `claude mcp add crowsnest --transport http http://localhost:3000/api/mcp`. crowsnest does not render video. |

Planned posts move through draft (no date), scheduled (future date), missed (derived on read),
and published, plus publishing and failed while a publish attempt runs.

## Feature map

What is built, by component. All of it is on `main` and runs in the Kit; "built" does not claim
end-to-end proof on a buyer's machine.

- **IG sync.** Track a channel, 30-day window sync of posts, reels, and carousels with
  thumbnails, per-reel play counts, rescoring against the channel baseline, launchd sidecar.
- **Discover.** Curated niche-grouped creator directory loaded by `npm run db:bootstrap`,
  idempotent one-click follow.
- **Feed.** Outlier grid and list, URL-driven filter bar (search, score, views, engagement,
  timeframe, follower band, analyzed), saved views (seeded Balanced and High Conviction),
  live follower-band counts (nano under 10k, micro 10k to 100k, mid 100k to 1M, macro 1M and
  up), quick preview sheet, keep-this-post shortlist, save to vault, manual import of one
  pasted post URL.
- **Analyze.** Agent-written analysis over MCP, on-demand transcription (whisper.cpp or Groq).
- **Mine.** Dashboard (overview, my reels, calendar), own-channel Graph metrics, planner
  calendar and plan dialog, vault, ideas inbox, persona and niche.
- **Remix.** Six-stage pipeline, local research assembly, hook, outline, and script prompts
  grounded in the source pattern, niche, and persona for the agent to fulfill over MCP, Copy
  prompt for Claude on each of those stages, idempotent finish to plan.
- **Publish.** Scheduled and immediate publish of a planned Reel via the Graph API.
- **MCP.** Typed read-and-remix tool surface for Reel Factory.
- **Kit.** One-command install under `~/.kai`, arm64 only, Polar license gate, `kai` CLI,
  launchd services for the Next server and the IG sidecar.
- **Onboarding.** First-run gate and four-step flow, `kai kit init` terminal setup.

## Roadmap

Open items stay open until built. Detail lives in each component's backlog (GitHub issues).

- **Onboarding redesign.** Move Instagram login and keys into the dashboard with live
  validation.
- **Bug board.** Work the open backlog items across feed, remix, mine, analyze, ig-sync, and
  onboarding. Run `scripts/plan-status.sh` for the current count; no count is committed.
- **Verify a real Kit install** end to end with real credentials.
- **TikTok and YouTube Shorts ingestion.** The platform chips were removed from the UI because
  the backend could not back them.
- **Intel Macs, Windows, and Linux.** `install.sh` refuses a non-arm64 machine today. Each new
  platform is one platform-specific service file (a systemd unit, a Windows service), not a
  rewrite of the release pipeline.

Shipped in v0.2: the core loop, the Kit (one-command install, license gate, `kai` CLI,
launchd services), Discover, and Graph API publish. See `packaging/CHANGELOG.md`.

## Brand Commitments

- Name: **Crowsnest**. Standing line: "Watch the channels you compete with."
- The visual system is the stock shadcn neutral theme (`base-maia`), dark by default with a
  light option, documented in `DESIGN.md`. Refine within it; do not replace it. Copy voice is
  plain, honest, and no-fabricated-data (a capability the app lacks does not appear in the UI;
  numbers are read off real records, never guessed on the client). No em dashes, straight
  quotes, sentence-case headings in docs.

## Evidence on Hand

- Grounded architecture pages under `documents/architecture/`, one per part, and per-component
  feature and test-case files under `scripts/e2e/cases/`.
- Kit changelog at `packaging/CHANGELOG.md`.
- No fabricated metrics, testimonials, customer counts, or benchmarks exist or may be
  invented.

## Product Principles

1. **Protect the whole loop.** Every surface should keep the creator moving from signal
   (an over-performing post) toward shipped output; analytics that dead-ends is off-strategy.
2. **Median-relative truth over vanity.** Performance is always relative to a channel's own
   baseline, so small accounts and big accounts are read on the same honest scale.
3. **Local and private by construction.** One creator, one Mac, data that never leaves it;
   design must never imply a cloud, an account, or shared state that does not exist.
4. **Honest surfaces.** Show only real data the app actually has; name the real dependency
   (the read key) plainly instead of hiding it until something fails.
5. **Low-friction solo operation.** Assume one person, self-serving, who wants to be watching
   channels within a minute, not configuring a team tool.

## Accessibility & Inclusion

No product-specific standard has been established beyond the shadcn primitives' own contrast
and focus behavior. Preserve that legibility floor; treat a formal standard as an open
decision, not an assumed one.
