# crowsnest — Product Document (Internal)

*The single place to see how many features crowsnest has and what state each is in. For the
builder: what is built, what is broken, what is roadmap. Grounded against the code and the
component docs under `architect/core-components/`, not marketing.*

**Status legend.**

- ● **Built** — the feature exists in the product on `main` and runs in the app.
- ◐ **Partial / broken** — built but with a known defect, or only partly landed.
- ○ **Roadmap** — planned, not yet built.

> **What "Built" claims.** ● means the feature is implemented and runs in the app as shipped in
> the Kit (v0.2). It does **not** claim it has been proven end to end on a buyer's machine with
> real credentials — that verification is still open (see the Appendix and each component's
> `02-architecture.md` "Open, not verified" section).

---

## Product scorecard

Across the full feature map (Section 4), by status:

| Status | Count | Share |
| --- | --- | --- |
| ● Built | 41 | 82% |
| ◐ Partial / broken | 6 | 12% |
| ○ Roadmap | 3 | 6% |

The whole core loop, sync, feed, analyze, save, and remix, is built (● everywhere). The 6
◐ rows are concentrated in **onboarding / kit**: the two `kai kit init` secret-prompt defects
(empty `IG_PASSWORD`, echoed `ANTHROPIC_API_KEY`) and their downstream (the sidecar won't start),
plus two partial `kai update` gaps. The two secret defects appear under both **Kit** and
**Onboarding** because they surface in both surfaces; they are one root cause in
`src/cli/kai.ts` (`ask({ secret: true })`). The 3 ○ rows are the onboarding dashboard redesign
(v0.3), TikTok/YouTube Shorts ingestion, and the unverified no-proxy LLM path.

> **The one blocker.** The empty-`IG_PASSWORD` defect is a hard blocker for the Instagram half of
> the product: the sidecar exits 78 and launchd crash-loops it, so port 8765 never comes up and
> IG sync is dead for every buyer who hits it. Root cause and fix are in `src/cli/kai.ts`; see
> `evidence/10-onboarding-bugs.md` and the onboarding/ig-sync component docs.

---

## 1. Overview

Crowsnest is a $99, one-time Mac Kit for a solo Instagram creator who wants an edge from watching
what already works elsewhere, without scanning a dozen accounts by hand. It tracks Instagram
creators, surfaces viral outliers scored against each channel's own baseline, analyzes them with
a language model, and runs a remix pipeline that turns an outlier into a script in the buyer's own
voice.

Everything runs on the buyer's own Mac against their own local SQLite database. There is no server
crowsnest owns, no subscription, and no second seat. Buyers get a Polar license key and install
with one command. The whole architecture is in
[`architect/highlevel-architecture.md`](../architect/highlevel-architecture.md).

**What makes it different**

- Local and one-time — no subscription, no cloud, the buyer's data never leaves their Mac.
- Outliers scored against each channel's *own* baseline, not a global threshold — a small account
  beating itself surfaces next to a big one.
- Not just discovery: the loop runs all the way to a script in the buyer's voice on a dated plan,
  then hands off through the MCP server to Reel Factory to produce the video.

---

## 2. Customer & persona

The persona crowsnest's founder built it for: a solo Instagram creator who opens the app, sees
which watched posts beat their own channel overnight, reads why one worked, and turns it into
their next post — rather than scrolling and guessing. One user, one machine, one seat.

Full framing: [`brd/crowsnest/01-concept-research.md`](brd/crowsnest/01-concept-research.md)
(problem, persona, actor model, market) and
[`brd/crowsnest/02-use-case.md`](brd/crowsnest/02-use-case.md) (the use-case flows).

---

## 3. The core loop

One paragraph, as a pipeline. Each stage is a component with its own docs under
`architect/core-components/`.

**IG sync** pulls tracked channels → **Feed** ranks the outliers → **Analyze** breaks down why one
worked → **Mine** saves it and generates an idea → **Remix** turns it into a script in the buyer's
voice → the finished remix hands off through the **MCP** server to Reel Factory, which produces the
video. The **LLM** layer powers analyze and remix; the **Kit** installs and supervises it all;
**Onboarding** is first-run setup.

A service being down removes only the step that needs it and leaves the rest working — the
degradation contract is in [`architect/shared/external-services.md`](../architect/shared/external-services.md).

---

## 4. Feature map

All features, grouped by component in loop order. Status verified against code (see each
component's docs). ● Built · ◐ Partial/broken · ○ Roadmap.

### IG sync

The Instagram sidecar (`services/ig/`): a localhost service on port 8765 holding one authenticated
instagrapi session, feeding the feed and outlier scoring. Details:
[ig-sync](../architect/core-components/ig-sync/01-concept-brief.md).

| Sub-feature | Description | Status |
| --- | --- | --- |
| Track a channel | Add an Instagram handle; profile resolved via the sidecar | ● |
| Sync posts | Walk 30-day window, upsert posts, reels, carousels + thumbnails | ● |
| View counts | Per-reel `/media-stats` pass reads the real play count | ● |
| Outlier scoring input | View counts rescored against each channel's own baseline | ● |
| Sidecar service (launchd) | Loopback, shared-secret; **won't start on empty `IG_PASSWORD`** | ◐ |
| TikTok / YouTube Shorts ingestion | Multi-platform; `platform` column reserved, no backend | ○ |

### Discover

A curated, niche-grouped directory of real Instagram creators at `/channels/discover`, an
alternative to typing a handle from memory when picking who to track. Details:
[discover](../architect/core-components/discover/01-concept-brief.md).

| Sub-feature | Description | Status |
| --- | --- | --- |
| Curated creator directory | 118 curated handles across fitness, finance, tech, business, loaded by `npm run db:bootstrap`; each card carries a one-line, metric-free reason | ● |
| One-click follow | Follow reuses the same add-channel and start-sync path a manual add uses; idempotent on an already-tracked handle | ● |
| Seed picker (first-run drop-in) | A capped multi-select variant built for a future first-run step; not mounted anywhere yet | ◐ |

### Feed

The outlier feed: a URL-driven, read-only view over the synced videos. Details:
[feed](../architect/core-components/feed/01-concept-brief.md).

| Sub-feature | Description | Status |
| --- | --- | --- |
| Outlier feed grid & list | Ranked cards or data table of outlier posts | ● |
| Filter bar | Search, score / views / engagement / timeframe / band / analyzed, in the URL | ● |
| Saved views | Named filter sets, plus seeded Balanced and High Conviction | ● |
| Follower-band counts | Live nano / mid / macro chip counts under other active filters | ● |
| Quick preview sheet | Right-side panel previewing one video without leaving feed | ● |
| Keep this post | Star toggle saving a whole post to a shortlist | ● |
| Save to vault | Lifts hook / style templates from a video's analysis | ● |
| Add post URL import | Manual foreground import of one pasted post | ● |

### Analyze

The text pass that breaks a video into hook, structure, and why it worked. Details:
[analyze](../architect/core-components/analyze/01-concept-brief.md).

| Sub-feature | Description | Status |
| --- | --- | --- |
| Analyze a video | Text pass writes hook, structure, tags, why | ● |
| On-demand transcription | Creates a transcript via whisper.cpp / Groq if missing | ● |
| Re-analyze | Fresh text pass, replaces text columns only | ● |
| Generate idea | Turns an analyzed video + persona into one inbox idea | ● |
| Automatic sync pass | Sync auto-analyzes and idea-generates top outliers | ● |

### Mine

The buyer's own space: my channel + metrics, the planner, and the vault / ideas / persona
surfaces. Details: [mine](../architect/core-components/mine/01-concept-brief.md).

| Sub-feature | Description | Status |
| --- | --- | --- |
| My channel + metrics | Own-channel dashboard, Graph API reach / saves / median tiles | ● |
| Planner calendar | Month grid of planned, missed, and published days | ● |
| Plan a post | Dialog to create / edit a dated planned post | ● |
| Save to vault | Saved posts, scripts, hook / style templates at `/vault` | ● |
| Generate idea | Ideas inbox to capture and triage post ideas | ● |
| Persona / own channel | Editable persona and niche; mark a channel own | ● |

### Remix

The six-stage remix pipeline that turns one analyzed source video into a script in the buyer's
voice, on a dated plan. Details: [remix](../architect/core-components/remix/01-concept-brief.md).

| Sub-feature | Description | Status |
| --- | --- | --- |
| 6-stage pipeline | Prompt, research, hook, style, script, finish — one session per video | ● |
| Research assembly | Local, no-model: analysis, transcript excerpt, top-5 similar outliers | ● |
| Hook / outline / script generation | Three model stages grounded in source pattern, niche, persona | ● |
| Quick Remix | One server pass runs every generation stage, lands on script | ● |
| Run log | Per-attempt `remix_runs` rows, success or failure, newest first | ● |
| Generation-blocked posture | Blocks hook / style / script on missing key or inferred proxy-down | ● |
| Finish to plan | Idempotent: reconciles script, creates undated draft planned post | ● |

### Handoff (MCP)

Where the loop leaves crowsnest. A finished remix (a script on a planned post) is handed off
through crowsnest's MCP server; Reel Factory consumes that surface to produce the finished reel,
outside crowsnest. crowsnest's value is upstream of production: it decides what to make and writes
the script and the brief, it does not render video. The in-app cook-and-publish studio was removed.
Details: [mcp](../architect/core-components/mcp/01-concept-brief.md).

### Kit

Packaging and lifecycle: install, license gate, the `kai` CLI, launchd services. Details:
[kit](../architect/core-components/kit/01-concept-brief.md).

| Sub-feature | Description | Status |
| --- | --- | --- |
| One-command install | `curl \| sh` lays the product under `~/.kai`, arm64-only, no deps | ● |
| License gate | Polar validate at download, activate at `kai login`, cached | ● |
| `kai` CLI | login, kit init, up, start, stop, status, doctor, update | ● |
| launchd services | Next server + IG sidecar, RunAtLoad + KeepAlive, survive reboot | ● |
| `kai kit init` — `IG_PASSWORD` prompt | Saved empty on a real TTY → sidecar exit 78 (blocker) | ◐ |
| `kai kit init` — key echo | `ANTHROPIC_API_KEY` echoed in plaintext to scrollback | ◐ |
| `kai update` | Re-runs installer, preserves `~/.kai/state`; default URL / path gaps | ◐ |

### Onboarding

First-run setup: license, Instagram login, keys — a terminal `kai kit init` step plus an in-app
first-run flow. Details: [onboarding](../architect/core-components/onboarding/01-concept-brief.md).

| Sub-feature | Description | Status |
| --- | --- | --- |
| First-run gate | Redirects a fresh install to `/first-run`, once | ● |
| First-run flow | Five screens: focus, Instagram, channels, first sync | ● |
| `kai kit init` setup | Terminal step writes `.env.local`, creates the db, starts the app | ● |
| kit init `IG_PASSWORD` prompt | Saves empty on a real TTY; sidecar crash-loops | ◐ |
| kit init `ANTHROPIC_API_KEY` prompt | Echoes the key in plaintext despite masking | ◐ |
| Dashboard login / keys redesign | Move IG login and keys into the dashboard, live validation | ○ |

### LLM

The cross-cutting language-model layer (`src/server/llm/client.ts`) powering analyze and remix,
using the buyer's `ANTHROPIC_API_KEY`. Details:
[llm](../architect/core-components/llm/01-concept-brief.md).

| Sub-feature | Description | Status |
| --- | --- | --- |
| Analysis engine | Structured outlier breakdown → `VideoAnalysisSchema` | ● |
| Remix script generation | Hooks, outline, 3 script variants in the buyer's voice | ● |
| Native vs. compat client + key gate | `LLM_BASE_URL` routing, `NoApiKeyError` before any request | ● |
| Connection check | $0 `count_tokens` ping; probe reports up / reachable / down | ● |
| No-proxy path verified end to end | Real Kit install hitting the Anthropic API directly | ○ |

---

## 5. Roadmap (not yet built)

Named because the component backlogs and packaging docs state them as future, not because a date
is set. Detail lives in each component's `05-backlog-to-enhance.md`; the standing overview is
[`roadmap.md`](roadmap.md).

| Capability | When | Owner doc |
| --- | --- | --- |
| Fix the two `kai kit init` secret defects | v0.3 (blocker first) | onboarding / kit |
| Onboarding redesign — IG login + keys into the dashboard, live validation | v0.3 | onboarding |
| Bug board — work the open `05-backlog` items across every component | v0.3 | all components |
| TikTok / YouTube Shorts ingestion | Later | ig-sync |
| Intel Macs, Windows, Linux | Later | kit / packaging |

---

## Appendix — Grounding & open items

- **Status source.** Each ● / ◐ / ○ is verified against the code behind that component, captured
  in the component's `02-architecture.md`, `03-feature-description.md`, and
  `04-test-cases.md`. This document rolls those up; it does not re-derive them.
- **"Built" does not claim buyer-verified.** No live Kit install has been proven end to end with
  real credentials (Instagram sync + real AI analysis, no-proxy LLM path). That is the largest
  open verification item — see the "Open, not verified" sections in the kit, ig-sync, and llm
  architecture docs.
- **The ◐ double-count.** The two `kai kit init` secret defects appear under both Kit and
  Onboarding because they surface in both. They are one root cause (`src/cli/kai.ts`
  `ask({ secret: true })`), not four bugs. The scorecard counts the rows as they appear in the
  map; the distinct-defect count is smaller.
- **Latent bugs surfaced while documenting** (flagged, not yet triaged): `kai update` defaults to
  `get.crowsnest.sh` which packaging says is not live; the entitlement path differs between
  `install.sh` (`~/.kai/state/entitlement.json`) and `kai login` (`~/.kai/entitlement.json`); and
  `cmdStatus` in `kai.ts` is dead code. See the kit docs.
- **The live bug board is not committed** — run `scripts/plan-status.sh` (or the crowsnest-status
  skill) for the current open-plan and open-backlog counts. This document carries no snapshot of
  those counts on purpose (`documents/index.md`).
