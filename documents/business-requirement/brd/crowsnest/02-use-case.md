# Crowsnest use case specification

## Document control

| Field | Value |
| --- | --- |
| Document | 02-use-case.md, use cases, scope, actors, and shared reference tables for the crowsnest core loop |
| Project code | CN |
| Version / Status | v0.2 / Draft |
| Date | 2026-09-02 |
| Audience | The solo founder who runs crowsnest, and anyone evaluating whether a behavior is intended |
| Platform | Crowsnest: the Next.js app under `src/app/(shell)`, its local database, the IG sidecar, and the local LLM proxy |
| Product context | A $99, one-time, local-first Mac Kit. Single local user, no roles or plans, Instagram only, Apple Silicon only in this version. |
| Reference documents | `docs/product-description/` in full (goal.md, README.md, foundations/, feed/, remix/, studio/, mine/, cross-cutting/, glossary.md); `01-concept-research.md` in this folder for the persona and actor model |

## Index

| Section | Contents |
| --- | --- |
| 1 | Use cases at a glance (UC-CN-01 to UC-CN-05) |
| 2 | Scope: shipped in v0.2, and what is later |
| 3 | Actor registry |
| 4 | Shared reference tables (defaults, thresholds, record states) |
| 5 | Use case flows, main, alternate, and error, for the core loop |

---

## 1. Use cases at a glance

| UC-CN | Name | Primary actor | Objective | Scope |
| --- | --- | --- | --- | --- |
| UC-CN-01 | Track a channel | Buyer | Add an Instagram account, own or a competitor or reference, to the set the IG sidecar fetches from. | v0.2, shipped, thin |
| UC-CN-02 | Sync tracked channels | IG sidecar | Fetch a window of recent posts per tracked channel and write new videos, without the buyer asking per post. | v0.2, shipped |
| UC-CN-03 | Analyze an outlier | Buyer | Turn a raw video into an analyzed one: hook type, structure beats, format and style tags, and why it worked. | v0.2, shipped |
| UC-CN-04 | Remix into a script | Buyer | Take an analyzed video through six stages, prompt, research, hook, style, script, finish, to a script on a planned post. | v0.2, shipped |
| UC-CN-05 | Cook and publish | Buyer | Render a planned post into a video in the studio, then publish it or mark it handled. | v0.2, shipped |

Use cases use the project-local `UC-CN-NN` scheme. All five are authored as full flows below; none is deferred to a later phase, because the whole core loop, feed to publish, is what shipped in v0.2.

---

## 2. Scope

### 2.1 Shipped in v0.2

The core loop and the Kit that installs it are both running product, not a plan. In scope, grounded in `docs/product-description/`:

- **The outlier feed and its filters.** A ranked grid of tracked-channel posts, a seeded "High Conviction" default view, follower-band counts, saved views, and Load more (`feed/feed.md`, `feed/filters-and-saved-views.md`).
- **The video detail page and analysis.** Player, metric chips, a median baseline, similar outliers, and the one-click analyze and re-analyze gate (`feed/video-detail.md`, `feed/analysis.md`).
- **Save to vault and generate idea.** Lifting a hook or a layout into a reusable template, and an exit from the core loop into an ideas inbox (`feed/save-to-vault.md`, `feed/generate-idea.md`).
- **The six-stage remix studio.** Prompt, research, hook, style, script, finish, with autosave, a run log, and Quick Remix (`remix/remix-overview.md` and the six stage documents).
- **The calendar and plan dialog.** Draft, scheduled, and missed planned posts, optionally carrying a script (`mine/calendar.md`, `mine/plan-dialog.md`).
- **The studio cook run and publish.** A watched background render, a status pill, and a publish gate tied to a stored render asset (`studio/cook-run.md`, `studio/publish.md`).
- **The Kit itself.** One-command install, a Polar license gate, and the `kai` CLI commands, packaged for Apple Silicon (`documents/architect/shared/packaging-and-release.md`).

Two use cases in this document, UC-CN-01 (track a channel) and UC-CN-02 (sync), sit partly outside the product description's own documented surface. Channel management lives on the `/channels` route, which the product description's scope decisions explicitly exclude ("routes outside it are out of scope", `README.md`). UC-CN-01 below is authored thin, at the level the source material actually supports, rather than invented in detail.

### 2.2 Later, not in v0.2

- **First run onboarding.** The `/first-run` wizard (license, Instagram login, keys) is documented only as a gate the shell redirects to until setup is done; the setup steps themselves are out of scope for the product description and are called out for a redesign in the roadmap.
- **Multi-platform ingestion.** TikTok and YouTube Shorts filters were removed from the shipped UI because the backend could not back them; the schema column stays so a later platform is additive (`documents/archive-do-not-read/product/V1-BRIEF.md`, used for scope framing only).
- **Intel Macs, Windows, and Linux.** The Kit is Apple Silicon only in this version; the other platforms are named as future in the packaging document itself (`documents/architect/shared/packaging-and-release.md`).

### 2.3 Out of scope, not tracked here at all

- Settings and logs pages, the ideas inbox, the vault list, the persona (audience and voice) settings, and the agent run terminal internals are all explicitly out of scope for the product description this document is grounded in (`README.md`, scope decisions). Where the core loop hands off to one of them, the flow below names the exit and stops there.

---

## 3. Actor registry

The actor model is authored in full in `01-concept-research.md` section 4. It is summarized here in the reference shape.

### People

| Actor | What they do in this product |
| --- | --- |
| **Buyer** | The single local user. Browses the feed, saves and analyzes videos, runs the remix, plans and cooks a post, and publishes or marks it handled. There is no second role. |

### System engines, crowsnest's own automation

| Actor | What it does in this product |
| --- | --- |
| **Feed and detail engine** | Direct server reads that render the feed, the video detail page, and the calendar from the local database. Nothing here is a write. |
| **Remix engine** | Runs the six remix stages, autosaves the session, and writes a script and a planned post on finish. |
| **Cook and publish engine** | Spawns and watches the local cook process, stores its status and render asset, and gates Publish and Save to calendar on that stored render. |

### External systems, outside the app

| Actor | What it is |
| --- | --- |
| **IG sidecar** | A local service crowsnest talks to over localhost. Fetches posts from tracked channels and writes videos; the only writer of the feed's contents. |
| **The LLM** | A local proxy plus an Anthropic API key. Every generation stage and analysis call it; browsing, saving, planning, and cooking do not need it. |
| **Instagram Graph API** | The official, token-gated path the buyer's own channel is measured through. Used only by the buyer's own channel dashboard, never by the tracked-channel feed. |
| **Polar** | The license vendor. Checked at install and at `kai kit init`, not on every run. |

---

## 4. Shared reference tables

Cross-cutting defaults that recur across the feed, the remix, and the sync. Every value below is a number stated in `docs/product-description/goal.md` or a linked feature document, kept in one place rather than repeated in every flow.

### 4.1 Feed and browsing defaults

| Setting | Value | Used by |
| --- | --- | --- |
| Feed page size | 24 | UC-CN-01 not applicable; feed browsing |
| Load more step | 24 | Feed browsing |
| Follower bands | nano 0 to 10k, mid 100k to 1M, macro 1M and up | Feed filters, the follower-band chips |
| Feed navigation order cap | 5,000 | Arrow-key navigation on the detail page |
| Recently viewed cap | 8 | The recently viewed list |

### 4.2 Remix defaults

| Setting | Value | Used by |
| --- | --- | --- |
| Target length, default | 45 seconds | UC-CN-04, the prompt stage |
| Target length options | 30, 45, 60, 90 seconds | UC-CN-04, the prompt stage |
| Variant count, default | 3 | UC-CN-04, the script stage |
| Fixed variant angles | 3 | UC-CN-04, the script stage |
| Transcript excerpt cap | 500 characters | UC-CN-04, the research stage |
| Research and similar-outlier cap | 5 | UC-CN-04, the research stage |
| Stage count | 6 (prompt, research, hook, style, script, finish) | UC-CN-04 |

### 4.3 Sync defaults (environment, not a user setting)

| Setting | Value | Used by |
| --- | --- | --- |
| Lookback window | 30 days | UC-CN-02 |
| Items per sync, cap | 200 | UC-CN-02 |
| Retries per upstream call | 3, jittered backoff | UC-CN-02 |
| Auto re-sync interval | Off by default (0, no timed re-sync) | UC-CN-02 |

### 4.4 Record states

| Record | States |
| --- | --- |
| Video | Analyzed or not, saved or not, present or removed |
| Planned post | Draft (no date), scheduled (a future date), missed (derived on read, a past date not marked published), published (marked by hand) |
| Create run (a cook) | Running, waiting, success, failed, canceled |
| Remix session | Its `stage` column: prompt, research, hook, style, script, finish (the furthest reached) |

> Every value above is a number or an explicit reference to the file it came from, never an adjective, matching the honesty rule the product itself carries: a value the app does not have renders as a dash, never a fabricated figure (`documents/archive-do-not-read/product/V1-BRIEF.md`, used for framing only).

---

## 5. Use case flows

### UC-CN-01: Track a channel

**Goal**
The buyer adds an Instagram account, their own channel or a competitor or reference channel, to the set of channels the IG sidecar fetches posts from, so its posts start appearing in the feed.

**Primary actor**
Buyer.

**Trigger**

- The buyer wants to start watching a new competitor or reference account.
- The buyer is setting their own channel for the first time, which the studio and the my-channel page measure against.

**Preconditions**

- The buyer has a working crowsnest install (the Kit's onboarding is complete).

**Main flow**

| Step | Actor | Action |
| --- | --- | --- |
| 1 | Buyer | Adds a channel by its Instagram handle, on the channels page. |
| 2 | Crowsnest app | Records the channel, marking exactly one channel `isOwn` if the buyer sets it as their own; every other channel is a reference or competitor. |
| 3 | IG sidecar | Picks up the newly tracked channel on its next sync (UC-CN-02) and begins fetching its posts. |

**Alternate flow: set or change the own channel**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | Buyer | Sets a different tracked channel as their own. |
| 1b | Crowsnest app | Enforces exactly one `isOwn` channel; the previous own channel becomes an ordinary tracked channel. |

**Postcondition**

- The channel is tracked and available to the next sync.
- If marked own, the my-channel page and the studio measure against it.

**Features covered**

- Add channel, manage channel (named, not detailed; the channels page is outside the product description's documented surface, per section 2.1).

**Note on this use case's depth.** Channel management lives on the `/channels` route, which `docs/product-description/README.md` names as explicitly out of scope for the behavior-spec prose this document is grounded in. What is written above is the level the source material actually supports: that a channel exists, that exactly one can be the buyer's own, and that a tracked channel is what the sidecar fetches from. The detailed add-channel dialog, its validation, and its error states are not authored here because inventing them would not be grounded in the source of truth.

---

### UC-CN-02: Sync tracked channels

**Goal**
The IG sidecar fetches a window of recent posts per tracked channel and writes new videos, so the feed stays current without the buyer asking for a sync per post.

**Primary actor**
IG sidecar.

**Trigger**

- The sidecar's own schedule (an auto interval, off by default) or however it is otherwise started; the product description traced the sync's defaults but not what starts a run in practice.

**Preconditions**

- At least one channel is tracked (UC-CN-01).
- The sidecar process is reachable over localhost.

**Main flow**

| Step | Actor | Action |
| --- | --- | --- |
| 1 | IG sidecar | Reads a 30-day lookback window of recent posts per tracked channel, at most 200 items per sync. |
| 2 | IG sidecar | Writes each new post as a video, carrying its metrics (views, likes, comments) and computing its outlier score against the channel's own baseline. |
| 3 | IG sidecar | Records how many posts it saw and how many it created for the run. |
| 4 | Crowsnest app | The feed reflects the new videos on its next read; nothing pushes into an already-open feed. |

**Alternate flow: a post disappears from the source**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | IG sidecar | Finds a previously synced post is gone from the source. |
| 1b | Crowsnest app | Soft-removes the video (marks it `deletedAt`). Its saved post is deleted with it; a planned post that pointed at it keeps the plan but loses the link. The feed still shows the removed post, marked "No longer on Instagram", rather than hiding it. |

**Error flow: the sidecar is not reachable, or an upstream call fails**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | IG sidecar | Is not running, or an upstream call to Instagram fails after 3 retries with a jittered backoff. |
| 1b | Crowsnest app | No new videos arrive. The feed still reads from the local database and goes stale rather than erroring; every downstream action on the videos already there, save, remix, plan, cook, still works. |
| 1c | Crowsnest app | A failed sync surfaces in the shell's failure strip, read on the next navigation, not pushed live. |

**Postcondition**

- The feed's videos reflect the last successful sync, not the live state of Instagram.
- A removed video's downstream links degrade rather than break.

**Features covered**

- The sidecar sync (background job).

**Business rules**

- The sync window and retry behavior are environment defaults, read once at boot, not changed from within the app.
- A sync never blocks the buyer; it runs in the background, and the failure strip is where a failed run surfaces.

---

### UC-CN-03: Analyze an outlier

**Goal**
The buyer turns a raw video into an analyzed one, writing down its hook type, structure beats, format and style tags, and a "why it worked" note, so the remix and the vault have something to build from.

**Primary actor**
Buyer.

**Trigger**

- The buyer opens an unanalyzed video's detail page and wants to know why it worked, or wants to remix, save, or generate an idea from it, all of which need an analysis first.
- An already-analyzed video needs a fresh pass (re-analyze), for example to backfill a per-beat transcript quote an older analysis lacks.

**Preconditions**

- The video exists and has not been removed by a sync.
- A transcript exists, or a transcript provider is reachable; the Anthropic API key is configured.

**Main flow**

| Step | Actor | Action |
| --- | --- | --- |
| 1 | Buyer | Opens the video detail page and clicks "Analyze this video" (or "Transcribe & Analyze" if no transcript is stored yet). |
| 2 | The LLM (via the app) | Makes a transcript on demand if none is stored, then runs the analysis pass: hook type, structure beats, format and style tags, and a why-it-worked note. |
| 3 | Crowsnest app | Writes the analysis row, shows a toast, and re-reads the page so the Hook and structure and Why it worked tabs both show the result from one pass. |

**Alternate flow: re-analyze an already-analyzed video**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | Buyer | Clicks Re-analyze next to the Beats heading. |
| 1b | The LLM (via the app) | Runs the same text pass again. |
| 1c | Crowsnest app | Replaces the stored hook, beats, tags, and note; leaves the video's layout and its first-analyzed timestamp untouched. |

**Error flow: the pass cannot run, or fails**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | Crowsnest app | No stored transcript and no reachable transcript provider: shows a dead-end alert, no button, because a click could do nothing. |
| 1b | Crowsnest app | A transcript exists but no Anthropic API key is configured: shows a key alert, no button. |
| 1c | The LLM (via the app) | A pass that is attempted fails (missing key, unmakeable transcript, the video removed underneath, or an unexpected model error): writes no partial row, re-enables the button, and shows the reason as a toast. |

**Postcondition**

- The video is analyzed, or the gate names exactly why it cannot be yet.
- Save to vault, generate idea, and remix are unlocked once an analysis exists.

**Features covered**

- Analyze, re-analyze, the analysis gate.

**Business rules**

- Analysis and re-analysis never leave a partial row: the analysis row is written whole or not at all.
- Re-analysis replaces only the text columns; it never touches the layout or the first-analyzed timestamp.
- Save to vault and generate idea are both gated on an analysis existing.

---

### UC-CN-04: Remix into a script

**Goal**
The buyer takes an analyzed video through six stages, prompt, research, hook, style, script, and finish, producing a script and a planned post, so an outlier becomes something they can post in their own voice.

**Primary actor**
Buyer.

**Trigger**

- The buyer clicks Remix on a video card or the detail page.

**Preconditions**

- The video is analyzed (UC-CN-03).
- For the generation stages (hook, style, script): the Anthropic API key is configured and the local LLM proxy is reachable.

**Main flow**

| Step | Actor | Action |
| --- | --- | --- |
| 1 | Buyer | Opens the remix; the studio opens the existing session or creates one, at the prompt stage with the topic prefilled. |
| 2 | Buyer | Sets a topic and target length (default 45 seconds) and clicks Continue. |
| 3 | Crowsnest app | Research stage assembles locally, no model call: source inputs, hook pattern, structure beats, an editable facts box, reference lists from the vault and similar outliers. |
| 4 | The LLM (via the app) | Hook stage generates hook options; the buyer chooses one, which unlocks Continue. |
| 5 | The LLM (via the app) | Style stage generates an outline from a chosen structure; the buyer edits its beats. |
| 6 | The LLM (via the app) | Script stage generates three variants against three fixed angles; the buyer picks one (existing is enough to continue; the pick is confirmed at finish). |
| 7 | Buyer | Finish stage shows the chosen hook and script summary; clicking "Finish and open studio" creates a planned post (undated draft) carrying the script, and offers a link into its studio. |

**Alternate flow: Quick Remix**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | Buyer | On the prompt stage, clicks Quick Remix instead of stepping through each stage. |
| 1b | The LLM (via the app) | Runs research, hooks (auto-picking the first), outline, and variants in one call. |
| 1c | Crowsnest app | Lands the studio on the script stage with every earlier stage reachable and editable, so the buyer can go back and change the auto-picked hook. |

**Alternate flow: leaving mid-remix and resuming**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | Buyer | Navigates away, reloads, or closes the tab mid-session. |
| 1b | Crowsnest app | The session is server-backed and autosaved; returning to the same video resumes at the furthest stage reached, with all autosaved fields intact. Only unblurred local text in a focused field is at risk. |

**Error flow: generation is blocked**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | Crowsnest app | No Anthropic API key configured, or recent attempts in the run log carry a connection error (the proxy looks down): the hook, style, and script stages show a block panel naming the reason, in place of their controls. |
| 1b | Buyer | Prompt and research stay usable regardless, since research makes no model call. |
| 1c | Crowsnest app | The block clears once one attempt against the proxy succeeds. |

**Postcondition**

- A planned post exists, undated, carrying the chosen script.
- The remix session's generated work (hooks, outline, variants) persists even if the buyer restarts the stage position.

**Features covered**

- The remix studio, all six stages, Quick Remix, the run log, autosave.

**Business rules**

- Finish is idempotent: clicking it twice, or finishing again after a reload, reuses the same plan rather than creating a duplicate, and re-reconciles the script to whichever variant is currently chosen.
- A generation that fails still writes a run log row, so the history of attempts is complete even when nothing was produced.
- Restart returns the session to the prompt stage without discarding any work already generated.

---

### UC-CN-05: Cook and publish

**Goal**
The buyer turns a planned post into a rendered video with a watched local cook run, then either publishes it through the running agent session or marks it handled without touching Instagram.

**Primary actor**
Buyer.

**Trigger**

- The buyer opens a planned post's studio page, reached from the remix's finish link or the plan dialog's "Create in Studio" button, and clicks Cook.

**Preconditions**

- A planned post exists (UC-CN-04 postcondition, or created directly from the calendar).
- The local terminal session and its rendering pipeline are available; this does not depend on the LLM proxy, the Graph token, or the sidecar.

**Main flow**

| Step | Actor | Action |
| --- | --- | --- |
| 1 | Buyer | On the studio page, reads the brief (title, score badge, script line, visual direction) and clicks Cook. |
| 2 | Crowsnest app (cook engine) | Spawns the cook process, claims a create run row in the running state, and reports its status back. |
| 3 | Crowsnest app | The panel shows a status pill ("cooking"), a running clock, and the terminal streaming the session's output. |
| 4 | Crowsnest app (cook engine) | On success, the pill reads "done", the clock stops, and the rendered video appears in the Output panel with its render asset stored on the run. |
| 5 | Buyer | Clicks Publish; a confirm asks to publish the render to Instagram; on accept, a serve command is handed to the running agent session. What that command does inside the session is outside crowsnest's own database. |
| 6 | Buyer | Alternately (or additionally) clicks Save to calendar to mark the plan handled in crowsnest's own database, with no confirm and no network call. |

**Alternate flow: leave while the cook is running**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | Buyer | Navigates away, or reloads, while the cook is still running. |
| 1b | Crowsnest app | The run keeps going server side, because its status is stored, not held in the page. On return (or after a reload), the panel shows no live pill and the button reads Cook again, but the run itself is unaffected and its render still gates Publish once it finishes. |

**Alternate flow: stop a running cook**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | Buyer | Clicks Stop while the cook is live. |
| 1b | Crowsnest app (cook engine) | Signals the whole process group and marks the run canceled, whether or not a live process was found to kill. The pill reads "canceled" and the clock stops. A canceled run does not produce a publishable render. |

**Error flow: the cook fails**

| Step | Actor | Action |
| --- | --- | --- |
| 1a | Crowsnest app (cook engine) | The run ends without a render; the pill reads "failed" and the clock stops. |
| 1b | Buyer | Reads the terminal output for whatever reason was printed, and clicks "Retry cook" to start a fresh run in the same session. |

**Postcondition**

- Publish is gated on the post's latest run carrying a stored render asset, read once on mount, so it survives a reload.
- Save to calendar is gated on a render captured live in the current session, so it does not survive a reload even while Publish stays enabled.

**Features covered**

- Cook, Stop, Retry cook, the run pill and clock, Publish, Save to calendar.

**Business rules**

- Publish never disables itself; a fast double click can hand the serve command to the session twice.
- Neither Publish nor Save to calendar makes a network call from crowsnest's own code; the planned posts table has no code path to any network call. What "publish" means in practice is the agent session's own `/ksa:serve` work, outside this app's boundary.
- A run whose process already exited on its own still reads canceled once Stop is clicked, rather than staying stuck at "cooking".

---

Verified against this repo commit `4f26fb9` for every product-description claim above.
