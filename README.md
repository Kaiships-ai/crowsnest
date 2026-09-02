# Crowsnest

**Find what's going viral. Understand why. Make your next video.**

Crowsnest is a local-first research tool for short-form video creators. Track creators,
discover viral outliers, analyze why they worked, and turn proven patterns into scripts
for your own niche.

**Runs locally on your Mac. No hosting. No subscription. Your research stays yours.**

`Local-first` · `macOS` · `SQLite` · `Next.js 16` · `AI-powered` · `Private project`

---

## 1. What is Crowsnest?

You pick the creators you want to learn from. Crowsnest collects their posts, then finds
the ones that significantly outperform that creator's normal numbers. Those are
**outliers** — the videos worth studying.

> A creator normally gets 20K views, then one video gets 300K.
>
> Crowsnest treats that video as an outlier: something worth studying because it performed
> far above the creator's baseline.

From there, AI explains the hook, the structure, and why the video likely worked. You save
the useful patterns into a **Vault**, and **Remix Studio** turns them into scripts adapted
to your niche.

## 2. Why Crowsnest?

> Most creators don't need more content ideas. They need better evidence about what already
> works.

The manual version of this workflow is slow and lossy:

- Scroll through dozens of accounts.
- Guess which posts matter.
- Compare performance by hand.
- Try to reason out why something worked.
- Rewrite it from scratch.

Crowsnest replaces that with a repeatable loop:

**Track → Detect → Analyze → Save → Remix**

## 3. How it works

```text
Track creators
      ↓
Find outliers
      ↓
Analyze what worked
      ↓
Save winning patterns
      ↓
Remix into your next script
```

- **Track** — add creators by handle or profile URL and group them into watchlists.
- **Find outliers** — Crowsnest surfaces posts performing well above each creator's baseline.
- **Analyze** — AI breaks down the hook, structure, and likely reasons for the performance.
- **Save** — keep the hooks and style templates that matter in your Vault.
- **Remix** — turn a saved pattern into a fresh script for your niche.

## 4. Features

- **Outlier Feed** — find videos performing unusually well relative to their creator's
  baseline; filter and sort by viral multiplier, timeframe, and engagement.
- **Video Analysis** — AI breakdown of a video's hook, structure, and why it likely worked.
- **Vault** — save reusable hook and style templates for rapid remixing.
- **Remix Studio** — transform proven patterns into scripts adapted to your niche.
- **Fleets** — organize tracked creators into named watchlists.
- **Dashboard** — key metrics, top outliers, and recently viewed videos.
- **Local-first media** — downloaded assets are stored locally rather than depending on
  expiring Instagram CDN URLs.

## 5. The user journey

```text
Settings → Instagram
        ↓
Add a channel
        ↓
Sync
        ↓
Open Outlier Feed
        ↓
Analyze a video
        ↓
Save hook / style to Vault
        ↓
Open Remix Studio
        ↓
Generate your script
        ↓
Create Prompt / Export
```

The app starts empty — there is no demo data. It fills up with real posts from the real
channels you choose to track.

Most of the product works without an API key. Only the AI generation steps need one, and
even those have a keyless alternative (**Create Prompt**, which exports a structured prompt
you paste into any LLM).

| Step                 | Needs Claude API? |
| -------------------- | ----------------- |
| Sync                 | No                |
| Browse outliers      | No                |
| Vault                | No                |
| Video analysis       | Yes               |
| Remix generation     | Yes               |
| Create Prompt export | No                |
| Local transcription  | No                |

The Remix Studio pipeline is staged (Prompt → Research → Hook → Style → Script). Every
generation stage needs `ANTHROPIC_API_KEY`; the Research stage's auto-assembly is the one
step that works keyless.

## 6. Installation

```bash
# 1. Install Node dependencies
npm i

# 2. Configure the environment (every variable is documented in the template)
cp .env.example .env.local
#    -> set IG_SERVICE_TOKEN to any long random string
#    -> set IG_USERNAME / IG_PASSWORD to a THROWAWAY Instagram account
#       (read the Instagram access warning below first)

# 3. Set up the database and its built-in filter presets
npm run db:migrate
npm run db:bootstrap

# 4. Install the Instagram sidecar (Python 3.12, managed by uv)
cd services/ig && uv sync && cd ../..

# 5. Start the sidecar (separate terminal — the app's sync depends on it)
npm run ig:service

# 6. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), go to **Settings → Instagram** and
connect the account, then add a channel and hit Sync.

### The Instagram sidecar

Instagram access runs through a separate Python process (`services/ig/`), started with
`npm run ig:service` on port 8765. The app's sync depends on it, so it must be running.
It is a `uv`-managed Python 3.12 project; `uv sync` (step 4) installs it.

### Verify a real sync

Once the account is connected in Settings, one command syncs a real channel and prints the
evidence straight out of the database, off the disk, and off the wire:

```bash
npm run verify:live -- @kallaway
```

It reports the `sync_jobs` row (`items_seen`, `items_created`, `stop_reason`), the stored
posts with their real captions and timestamps, the downloaded assets with real byte sizes,
a `curl -I` (200) and a `Range` request (206) against a genuinely Instagram-sourced asset, a
scan for leaked CDN URLs in the rendered DOM, and a second consecutive sync proving
`items_created = 0` with no duplicated media pks.

It **never logs in itself** — if the sidecar has no session it stops and tells you to
connect in Settings. A script that attempts a blind login is how accounts get challenged. It
also fails loudly on a zero-byte asset or a leaked CDN URL rather than printing a reassuring
summary.

## 7. Configuration

Copy `.env.example` to `.env.local` and fill it in. **Variables are validated at boot**
(`src/server/config.ts`): the app refuses to start with a missing or malformed required
value instead of failing later on a click.

**Instagram**

| Variable | Required | Purpose |
|----------|----------|---------|
| `IG_SERVICE_TOKEN` | **yes** | Shared secret between the app and the Python sidecar |
| `IG_USERNAME` / `IG_PASSWORD` | for sync | Instagram credentials, read by the sidecar only |
| `IG_SESSION_PATH` | no | Persisted session blob (default `data/ig-session.json`, mode 0600) |
| `IG_DEVICE_SEED` | no | Pins the device fingerprint across restarts |
| `IG_PROXY` | no | Proxy DSN for Instagram traffic |
| `IG_SERVICE_URL` | no | Sidecar base URL (default `http://127.0.0.1:8765`) |
| `IG_REQUEST_TIMEOUT_MS` / `IG_DOWNLOAD_TIMEOUT_MS` | no | Per-call timeouts (30s / 120s) |

**AI**

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` / `LLM_BASE_URL` / `CLAUDE_MODEL` | for AI | Analysis + remix. `LLM_BASE_URL` is deliberately not `ANTHROPIC_BASE_URL`: Claude Code honors that name and would route a Max session through the proxy instead |

**Local media and transcription**

| Variable | Required | Purpose |
|----------|----------|---------|
| `MEDIA_ROOT` | no | Local asset storage (default `data/media`) |
| `EAGER_VIDEO_DOWNLOAD` | no | `true` downloads videos during sync instead of on first play |
| `MEDIA_RETENTION_DAYS` | no | Asset prune threshold (default 90) |
| `WHISPER_CPP_BIN_PATH` / `WHISPER_MODEL_PATH` | no | Local transcription |

**Sync**

| Variable | Required | Purpose |
|----------|----------|---------|
| `LOOKBACK_DAYS` | no | How far back a sync reaches (default 30) |
| `MAX_ITEMS_PER_SYNC` | no | Safety cap per channel per run (default 200) |

**Database**

| Variable | Required | Purpose |
|----------|----------|---------|
| `CROWSNEST_DB_PATH` | no | SQLite path (default `data/crowsnest.db`) |

## 8. ⚠️ Instagram access

Crowsnest uses [`instagrapi`](https://subzeroid.github.io/instagrapi/) and Instagram's
**private mobile API**, because the official API cannot enumerate arbitrary creators' posts.

> **This violates Meta's Terms of Service and carries account risk.**
>
> Use a throwaway Instagram account. **Never use your main account.**

Why the official API cannot be used: Crowsnest analyses **other creators'** posts.
Instagram's Basic Display API was shut down in December 2024, and the Graph API only reaches
accounts you own or that have authorised your app. There is no sanctioned way to do what
this product does.

What that means in practice:

- **It violates Meta's Terms of Service.**
- **Accounts get challenged, rate-limited, and sometimes permanently banned.** Use a
  throwaway account. Never your main one.
- Mitigations are built in — one persistent session (no re-login storms), a pinned device
  fingerprint, jittered pacing, exponential backoff with full jitter on `feedback_required`,
  and optional proxy support — but **none of them are guarantees**.

`services/ig/README.md` has the operational detail, including how to recover from a
challenge.

## 9. AI and local transcription

**Claude** (needs `ANTHROPIC_API_KEY`) powers video analysis: the hook breakdown, the
structure breakdown, and remix generation.

**Local Whisper** (`whisper.cpp`, with Metal acceleration; Groq API as a fallback) powers
local, keyless transcription. For local transcription and manual reel import:

```bash
brew install yt-dlp whisper-cpp
```

That installs the `whisper-cli` binary only — it does **not** fetch the GGML model file
whisper-cli needs. Download one to the default path (or set `WHISPER_MODEL_PATH`):

```bash
mkdir -p ~/.cache/whisper
curl -L -o ~/.cache/whisper/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

Settings' Local Binaries section shows amber with the exact missing path if this step is
skipped.

**Keyless mode.** You do not need an Anthropic key to use Crowsnest. The **Create Prompt**
export (on the Video Detail page, the Remix Script stage, or a saved script's Vault card)
copies a structured markdown prompt to paste into any LLM, as a keyless alternative to
analysis and remix generation.

## 10. Architecture

```text
                    Crowsnest
                        │
          ┌─────────────┴─────────────┐
          │                           │
      Next.js App              Python IG Sidecar
          │                           │
          │                      instagrapi
          │                           │
          └──────────────┬────────────┘
                         │
                    SQLite / Drizzle
                         │
                    Local Media
                         │
                Claude / Whisper
```

- **Stack**: Next.js 16 (App Router, TypeScript) + Tailwind CSS + shadcn/ui
- **Database**: SQLite (better-sqlite3) with Drizzle ORM
- **Instagram data**: a Python sidecar (`services/ig/`) wrapping `instagrapi`, pinned to
  2.18.9, holding one authenticated session. Node talks to it over localhost HTTP with a
  shared-secret header and a timeout on every call.
- **Media**: thumbnails, videos, and avatars are downloaded to `MEDIA_ROOT`,
  content-addressed by SHA-256, and served from `/api/media/<assetId>` with HTTP Range
  support. Instagram CDN URLs expire within hours and are never stored or rendered.
- **yt-dlp**: manual single-reel import by URL (keyless, not part of sync).
- **AI analysis**: Claude API for video hook/structure analysis and script remixing.
- **Transcripts**: local whisper.cpp (with Metal acceleration) or Groq API fallback.

## 11. Development

This is a strict TypeScript project. Before committing, ensure:

```bash
npm run build  # Must succeed
npm run test   # Full suite must pass
npm run lint   # No ESLint errors
git status     # Working tree clean
```

`npx tsc --noEmit` passes clean. There is no known baseline of pre-existing errors, so any
error you see is one you introduced.

### The build workflow

```text
Idea
 ↓
Brainstorm
 ↓
Plan
 ↓
Worktree
 ↓
Build
 ↓
Verify
 ↓
PR
```

Crowsnest is built and maintained through a set of skills (Claude Code plugins under
`plugins/`, plus repo-local skills under `.claude/skills/`). The build spine above is the
default flow; a `[GATE]` is a point where a human signs off before the flow continues. New
or reworked components go through the dedicated `/crowsnest-component` skill (5 phases, 4
gates), which delegates plan, build, and verify to the `ship` skills and keeps each
component's five-doc block and mkdocs nav in sync.

### Running locally

If you work in Claude Code, `/crowsnest-up` brings the stack up in one step and leaves it
running: the 9router LLM proxy on port 20128, the dev server on port 3000 in a cmux pane,
and a connected browser already pointed at the app. Each step checks before it starts, so
running it against a stack that is already up does nothing.

The dev server has to run in a cmux pane. A `npm run dev` backgrounded from a sandboxed tool
call gets reaped after a minute or two, and its log simply ends mid-request with no crash
trace. A pane runs in a real shell that survives.

Open the app at `http://localhost:3000`, never `127.0.0.1`. Next 16 blocks Server Actions
from the wrong origin, and it does it silently.

<details>
<summary>Available npm scripts</summary>

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server (hot reload) |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint on the codebase |
| `npm run test` | Run tests once (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run db:generate` | Generate Drizzle migrations from schema |
| `npm run db:migrate` | Apply migrations to SQLite database |
| `npm run db:bootstrap` | Insert the built-in filter presets (idempotent) |
| `npm run typecheck` | TypeScript check with no emit |
| `npm run ig:service` | Start the Python Instagram sidecar (port 8765) |
| `npm run verify:live -- @handle` | Sync a real channel and print the live evidence |
| `npm run e2e` | Run the browser e2e harness |

</details>

<details>
<summary>Development skills and workflow cases</summary>

Two plugins under `plugins/`, registered by `.claude-plugin/marketplace.json` as the
`crowsnest-local` marketplace: `ship` (build-and-ship lifecycle) and `taste` (design lane).
Repo-local skills live under `.claude/skills/`. Invoke plugin skills as `ship:<name>` /
`taste:<name>`; invoke repo-local ones as `/<name>`. `[GATE]` marks a human sign-off.

**Workflow cases**

Pick the case that matches the work, then follow its numbered steps. `[GATE]` marks a human
sign-off.

```text
                        What are you doing?
                                │
   ┌─────────────┬──────────────┼───────────────┬──────────────┐
   │             │              │               │              │
 new/rework    fix a bug     ad-hoc          design a      plan content
 a component   from backlog  feature/build   UI change     for the channel
   │             │              │               │              │
   ▼             ▼              ▼               ▼              ▼
 A. /crowsnest  B. next-bug   C. ship:brain-  D. /cn-design  G. /cn-weekly
    -component     .sh →          storming        -router →      → /cn-remix
    (5 phases,     /fix-          → plan →         taste:*
    4 gates)       backlog-       build →         → back to
                   item          verify → PR      A or C

   Supporting cases:  E. docs (document-component)   H. new skill (ship:writing-skills)
                      F. release (release-prep.sh)   I. every PR (ci.yml)
```

**A. New or reworked component** — `/crowsnest-component` (5 phases, 4 gates). Quality bar:
`.claude/skills/crowsnest-component/house-style.md`.

1. P1 research and concept `[GATE]`
2. P2 design, features-first `[GATE]`
3. P3 plan via `ship:writing-plans` `[GATE]`
4. P4 build via `ship:subagent-driven-development`
5. P5 verify via `ship:verification-before-completion` + doc-sync via `document-component` `[GATE]`

**B. Bug fix from the backlog** — `/fix-backlog-item`. Never self-merges. Risky surfaces
(`src/cli`, `packaging`, `src/server/db`, `services/ig`, `.env`, launchd) open a
draft/needs-human PR and set the row `in-review`. Nightly unattended variant:
`.github/workflows/nightly-autofix.yml` (cron inert until enabled).

1. `scripts/next-bug.sh` picks the top open bug row
2. `ship:using-git-worktrees` isolates the work
3. `ship:systematic-debugging` writes the failing test first, then the fix
4. `ship:verification-before-completion`
5. Open PR `[GATE: human merges]`

**C. Ad-hoc feature or build** (no component doc).

1. `ship:brainstorming` `[GATE]`
2. `ship:writing-plans` `[GATE]`
3. `ship:using-git-worktrees`
4. `ship:subagent-driven-development`
5. `ship:verification-before-completion`
6. `ship:finishing-a-development-branch` `[GATE]`

**D. UI / design.**

1. `/cn-design-router` routes to the right `taste:*` lane
2. Do the design work in that lane
3. Re-enter case A or C to ship

**E. Docs.**

1. `document-component` scaffolds or edits the five-doc block to `house-style.md`
2. Specs go to `documents/planning/spec/`, plans to `documents/planning/implementation-plan/`
3. Check status with `/where-are-we`; manage rows with `/backlog-board`

**F. Release.**

1. `scripts/release-prep.sh <ver>` refuses a dirty tree or non-main, bumps `package.json`,
   prepends `packaging/CHANGELOG.md`, runs tests, commits and tags, and prints the push line
   (does not push)
2. Human pushes the tag `[GATE]`
3. `.github/workflows/release.yml` runs the test gate + a fresh-HOME Kit smoke, then uploads
4. The Kit ships: `kai` CLI in `src/cli/`, `packaging/install.sh.template` + a Cloudflare
   Worker license gate + Polar
5. Rollback if needed: `kai rollback` / `packaging/rollback.sh`

**G. Content / marketing.** Both steps use the `crowsnest` MCP server.

1. `/cn-weekly` builds the weekly funnel plan (2 gates)
2. `/cn-remix` analyzes a video into a saved script + planned post (5 gates)

**H. Author a new skill.**

1. `ship:writing-skills`

**I. Every PR.**

1. `.github/workflows/ci.yml` runs typecheck + lint + vitest + `scripts/testid-audit.sh`

**`ship` plugin** (build-and-ship, model- and `/`-triggerable)

| Skill | Purpose |
|-------|---------|
| `ship:brainstorming` | Shape a problem, classify it (spike / bounded / architectural) |
| `ship:writing-plans` | Write a phase-by-phase implementation plan to `documents/planning/` |
| `ship:using-git-worktrees` | Isolate the work in a dedicated branch or worktree |
| `ship:subagent-driven-development` | Dispatch the build across sub-agents, then review the diff |
| `ship:systematic-debugging` | Root-cause a bug, failing test first (red, green, refactor) |
| `ship:verification-before-completion` | Prove it works before claiming done |
| `ship:finishing-a-development-branch` | Commit, push, PR, merge decision |
| `ship:writing-skills` | Author a new skill for either plugin |

**`taste` plugin** (design lane). `*` = triggerable only as `/taste:<name>`

| Skill | Purpose |
|-------|---------|
| `taste:hallmark` | Anti-slop design for greenfield pages, audits, redesigns |
| `taste:emil-design-eng` | Design-engineering polish and component craft |
| `taste:apple-design` | Apple-grade gesture and motion feel |
| `taste:find-animation-opportunities` | Spot where motion would help |
| `taste:improve-animations` | Plan and apply animation improvements |
| `taste:animation-vocabulary` | Name and specify a motion effect |
| `taste:review-animations` * | Review animation quality against standards |
| `taste:pick-ui-library` * | Choose a UI dependency |
| `taste:prototype` * | Throwaway UI mock |

**Repo-local skills** (`.claude/skills/`). `/` = user-invoked only

| Skill | Invoke | Purpose |
|-------|--------|---------|
| `crowsnest-component` | `/` | Component concept-to-shipped, 5 phases / 4 gates (case A) |
| `fix-backlog-item` | `/` | Take one backlog bug row through fix to PR (case B) |
| `document-component` | `/` | Scaffold/edit the five-doc block and mkdocs nav (case E) |
| `where-are-we` | `/` + model | Lego status: open-backlog counts and active plans |
| `backlog-board` | `/` + model | Add, close, or review backlog rows |
| `cn-design-router` | `/` | Route a design request to the right `taste:*` skill (case D) |
| `cn-weekly` | `/` + model | Weekly content funnel plan, hands off to `cn-remix` (case G) |
| `cn-remix` | `/` + model | Analyze a video into a script + planned post (case G) |
| `crowsnest-up` | `/` | Boot the local stack (9router, dev server, browser) |
| `product-description` | `/` + model | Build an outside-in product-description doc repo |

**Key scripts and entry points**: `scripts/next-bug.sh` (bug queue), `scripts/release-prep.sh`
(one-command release), `scripts/testid-audit.sh` (testid coverage), `scripts/plan-status.sh`
(backlog and plan counts), `scripts/seed-e2e.ts` + `scripts/e2e/run.sh` (`npm run e2e`),
`packaging/rollback.sh`. Workflows: `.github/workflows/{ci,release,nightly-autofix}.yml`.
Kit and gate: `packaging/{install.sh.template,gen-install.sh,release.sh,worker/}`,
`src/cli/{kai,license,service-darwin,runtime}.ts`.

</details>

## 12. Testing

- **Run `npm install` after pulling.** The suite depends on `jsdom`,
  `@testing-library/react`, and `@testing-library/dom` as devDependencies. Without them
  `use-sync-progress.test.ts` fails at import with a misleading module-resolution error.
- **Component tests must call Testing Library's `cleanup()` explicitly in `afterEach`.** This
  repo imports vitest helpers by name, so RTL's automatic cleanup never registers.
- **The DOM environment is per-file, not global.** Add a `/** @vitest-environment jsdom */`
  docblock to the files that need it; the other 500-odd tests run in node.
- **A mock must match the shape production actually returns.** Type fixtures with `satisfies`
  against the interface.
- **A sweep that reports nothing must be proven able to report something.** Plant a
  known-dead symbol and confirm the sweep finds it before trusting a clean result.
- Before committing: `npm run build`, `npm run test`, `npm run lint`, and `npm run typecheck`
  must pass, with a clean working tree.

<details>
<summary>Testing notes (historical debugging lessons)</summary>

- RTL cleanup: without an explicit `cleanup()` in `afterEach`, components from earlier tests
  stay mounted and their event listeners fire during later ones. That produced two phantom
  poll-cadence failures that cost real time to diagnose, and the symptom pointed at the
  component under test rather than at the leak. See `use-sync-progress.test.ts`.
- Mock shape drift: `ig-actions.test.ts` mocked `igClient.health` with the sidecar's raw
  snake_case body, which the real client never returns because it maps first — so a drift
  test exercised a path production could not reach, and a real bug survived an adversarial
  audit.
- Dead-code sweeps: three sweeps gave wrong answers in one session. Two reported live code as
  dead (grepping cross-file importers cannot see same-file callers); one reported a clean tree
  it had never opened (an unquoted `$files` in a zsh `for` loop does not word-split). Also,
  *only tests reference it* is not the same as dead — `loadConfig` in `src/server/config.ts`
  is a deliberate seam that exists so a spec can assert the refuse-to-start behaviour without
  mutating `process.env`.

</details>

## 13. Documentation

Full architecture, product requirements, component docs, planning documents, and historical
material live under `documents/`, rendered as an mkdocs-material site. Preview locally with
`mkdocs serve` (then open [http://localhost:8000](http://localhost:8000)).

| Directory | Contents |
|-----------|----------|
| `documents/index.md` | The doc index |
| `documents/business-requirement/` | What Crowsnest is and must do (product document, per-release BRD, roadmap) |
| `documents/architect/` | How it is built: high-level architecture, cross-cutting `shared/` docs, one folder per component under `core-components/` (each with five docs: concept brief, architecture, feature description, test cases, backlog) |
| `documents/planning/` | Specs and implementation plans |
| `documents/archive/` | Frozen older docs, kept for history, not current |

Packaging and release detail: `documents/architect/shared/packaging-and-release.md` and the
Kit changelog at `packaging/CHANGELOG.md`. Agent workflow, skills, and doc conventions are in
`AGENTS.md` (included by `CLAUDE.md`).

## 14. Known limitations

- **Video Detail returns HTTP 200 instead of 404 for not-found content.** A missing video
  renders the correct not-found *content* in both `next dev` and a production build, but the
  status code doesn't flip to 404 — a deeper interaction between `generateMetadata` and
  `notFound()` in this Next version, not a missing `notFound()` call. Only matters if
  something external checks the status code; the page itself is correct.
- **Fleet search within a fleet is deferred.** The Feed's Fleet filter scopes to a whole
  Fleet; searching within one for a single channel isn't wired into the Select yet, though the
  query layer (`FeedFilters.channelId`) already supports it.
- **Saved scripts do not persist a Vault hook ID relationship.** `remix_sessions` stores the
  chosen hook as raw text, not a `vault_items.id` — there's no column to link a saved script
  back to the specific Vault hook that seeded it without a schema migration adding one.

## 15. Costs

| Capability          | Cost                |
| ------------------- | ------------------- |
| Channel sync        | Free                |
| Outlier detection   | Free                |
| Vault               | Free                |
| Local transcription | Free                |
| Manual reel import  | Free                |
| Claude analysis     | Anthropic API usage |
| Remix generation    | Anthropic API usage |

Crowsnest has no paid scraping vendor and no hosting requirement. Channel sync runs through a
local Python process against an Instagram account you supply — the sync cost is account risk,
not a scraping bill (see the Instagram access warning above). Claude API usage for analysis
and remix is the only paid integration, and it is optional (Create Prompt is a keyless
alternative). Local transcription (whisper.cpp) and manual reel import (yt-dlp) are free.

## 16. License

Private project.
