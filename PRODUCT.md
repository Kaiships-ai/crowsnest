# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: a **solo content creator** growing their own Instagram, working alone on
their own Mac. They install crowsnest once from a terminal, then run it as a local desktop
app in the browser. They care about knowing what to make next, low setup friction, and
speed. They are not an agency or a team; there is one operator, one machine, one vault.

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

The durable differentiator to protect is the **full feed → remix loop in one tool**, with a
clean handoff to production, not analytics alone. A neighboring product can show competitor
metrics; crowsnest takes the creator from spotting an over-performing post to a finished
remix, then hands off through its MCP server to Reel Factory, which produces the video. The
median-relative scoring (a nano account beating its own median
reads as loud as a viral hit) and the local-and-private posture (runs alone on the buyer's
Mac, Instagram read through a local sidecar, data never leaves the machine) are core
supporting mechanisms, but the end-to-end loop is the thing every future decision must keep
whole.

## Operating Context

- Installed and run on the buyer's own Mac (**Apple Silicon only**). The dashboard runs
  locally at `localhost:3000`; there is no hosted/cloud version and no account to sign into.
- Setup is a terminal step, `kai kit init`, run after `kai login <license>`; it writes
  `.env.local`, creates the local sqlite database, and starts the app.
- Instagram data is read through a **local Instagram sidecar** (instagrapi) that the app
  signs into using a throwaway account's session — this sign-in is the "read key" that every
  channel-watch and every sync depends on. Read-only; nothing is posted.
- Background services run under **launchd** and survive a reboot; `kai` CLI manages the
  lifecycle (`login`, `kit init`, `up`, `start`, `stop`, `status`, `doctor`, `update`).
- Distributed as the **$99 Kit** with a Polar license gate checked before the tarball is
  served and again by size/checksum after download.
- The in-app **first-run flow** (`/first-run`) takes a fresh install to a tracked channel
  and a first sync: FOCUS → INSTAGRAM (the read key) → CHANNELS → FIRST SYNC.

## Capabilities and Constraints

- Core loop is built and runs: sync, feed and filters, video detail + analysis, save to
  vault + generate idea, the six-stage remix studio, and calendar and plan dialog. The
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
- Constraints future work must respect: Apple Silicon only; single-user local install; local
  sqlite (`data/crowsnest.db`, plaintext secrets, never returned to the browser); Instagram
  access is read-only and depends on a running local sidecar logged into a throwaway account
  (no sidecar / no read key ⇒ no sync).
- This is not the stock Next.js — APIs, conventions, and file structure diverge; a custom
  `tsx server.ts` fronts the app, with a Python sidecar under `services/ig/`.
- Terminology to keep consistent: **read key** (the throwaway-account Instagram session),
  **channel** (a watched competitor account), **sync**, **vault**, **remix**.
- Undecided / open product facts (do not fabricate): end-to-end verification on a real
  buyer's machine with real credentials is still open; TikTok / YouTube Shorts ingestion and
  the onboarding dashboard redesign (v0.3) are roadmap, not built.

## Brand Commitments

- Name: **Crowsnest**. Standing line: "Watch the channels you compete with."
- The **current visual world is a binding commitment** — refine within it, never replace it.
  It is an austere editorial system: warm-paper / dark grounds, tight grotesque display,
  monospace eyebrows and status labels, a single brown/amber accent (`--primary`), green for
  positive/connected, restrained borders over decorated cards. Copy voice is plain, honest,
  and no-fabricated-data (a capability the app lacks does not appear in the UI; numbers are
  read off real records, never guessed on the client). No em dashes, straight quotes,
  sentence-case headings in docs.

## Evidence on Hand

- Grounded product docs under `documents/` — `business-requirement/product-document.md`
  (feature scorecard, real state), `roadmap.md`, and per-component five-doc sets under
  `documents/architect/core-components/`.
- Kit changelog at `packaging/CHANGELOG.md`.
- No fabricated metrics, testimonials, customer counts, or benchmarks exist or may be
  invented; the docs are explicit that "Built" does not claim end-to-end buyer-machine
  verification.

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
   channels within a minute — not configuring a team tool.

## Accessibility & Inclusion

No product-specific standard has been established beyond the existing UI's own contrast
discipline (documented token contrast ratios in `src/app/globals.css`). Preserve that
legibility floor; treat a formal standard as an open decision, not an assumed one.
