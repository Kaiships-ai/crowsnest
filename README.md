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

- **Discover creators** — browse a curated, niche-grouped list of Instagram creators and
  follow one with a click; it queues a sync the same way adding a channel by hand does.
- **Outlier Feed** — find videos performing unusually well relative to their creator's
  baseline; filter and sort by viral multiplier, timeframe, and engagement.
- **Video Analysis** — AI breakdown of a video's hook, structure, and why it likely worked.
- **Vault** — save reusable hook and style templates for rapid remixing.
- **Remix Studio** — transform proven patterns into scripts adapted to your niche.
- **Schedule and publish** — attach a video and caption to a planned post, then schedule it
  or publish it immediately to your own Instagram channel through the official Graph API;
  an in-process scheduler claims and publishes due posts automatically, survives a dev
  server restart, and retries a failed attempt with backoff.
- **Fleets** — organize tracked creators into named watchlists.
- **Dashboard** — key metrics, top outliers, and recently viewed videos.
- **Local-first media** — downloaded assets are stored locally rather than depending on
  expiring Instagram CDN URLs.

## 5. The user journey

```text
Settings → Instagram
        ↓
Add a channel  ←──── or: pick a niche → follow creators (Discover)
        ↓
Sync  ←──────────────── follow queues the first sync itself
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
        ↓
Plan it on the My channel calendar
        ↓
Attach a video + caption, schedule or publish now
```

Instead of typing a handle by hand, open **Discover** (`/channels/discover`), pick a niche
tab, and click Follow on a curated creator; it adds the channel and queues the first sync in
one click, landing back on the same path at Sync.

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

General workflow (plan, build, debug, verify, review, PR) runs on
[pstack](https://github.com/michael-denyer/pstack-claude): start a task with `/poteto-mode`
and it picks the playbook. The repo keeps only the skills pstack does not cover, flat under
`.claude/skills/`: the `gitnexus-*` code-graph skills, the design lane, `proof-video`, and
`product-description`.

### Running locally

Run the 9router LLM proxy on port 20128 and the dev server (`npm run dev`) on port 3000.

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
| `npm run e2e` | Run the bash browser e2e smoke harness |
| `npm run test:e2e` | Run the Playwright e2e lane (mock-backend, keyless) |
| `npm run skill-lint` | Validate every `.claude/skills` skill |

</details>

<details>
<summary>Development skills and release</summary>

**Repo skills** (`.claude/skills/`, validated in CI by `scripts/skill-lint.sh`)

| Skill | Purpose |
|-------|---------|
| `gitnexus-*` | Code-graph exploring, impact analysis, debugging, refactoring, CLI |
| `hallmark` | Anti-slop design for greenfield pages, audits, redesigns |
| `emil-design-eng` | Design-engineering polish and component craft |
| `apple-design` | Apple-grade gesture and motion feel |
| `find-animation-opportunities` | Spot where motion would help |
| `improve-animations` | Plan and apply animation improvements |
| `review-animations` | Review animation quality against standards |
| `animation-vocabulary` | Name and specify a motion effect |
| `pick-ui-library` | Choose a UI dependency |
| `shadcn` | Add, fix, and style shadcn components |
| `verify` | Launch an isolated app on :3001, drive a journey, capture evidence |
| `proof-video` | Caption and annotate a UI proof recording |
| `product-description` | Build an outside-in product-description doc repo |

**Release.** `scripts/release-prep.sh <ver>` refuses a dirty tree or non-main, bumps
`package.json`, prepends `packaging/CHANGELOG.md`, runs tests, commits and tags, and prints the
push line. A human pushes the tag, then `.github/workflows/release.yml` runs the test gate and a
fresh-HOME Kit smoke and uploads. Roll back with `kai rollback` or `packaging/rollback.sh`.

**Connect the MCP.** The running app exposes an MCP server over HTTP. Register it with Claude
Code once:

```bash
claude mcp add crowsnest --transport http http://localhost:3000/api/mcp
```

**Every PR.** `.github/workflows/ci.yml` runs typecheck, lint, vitest,
`scripts/testid-audit.sh`, and `scripts/skill-lint.sh`.

**Key scripts**: `scripts/next-bug.sh` (bug queue), `scripts/release-prep.sh`,
`scripts/testid-audit.sh`, `scripts/plan-status.sh` (backlog and plan counts),
`scripts/seed-e2e.ts` + `scripts/e2e/run.sh` (`npm run e2e`), `scripts/skill-lint.sh`,
`packaging/rollback.sh`. Workflows: `.github/workflows/{ci,release}.yml`.
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
