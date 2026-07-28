# Crowsnest

Crowsnest is a personal, local-first research tool for short-form video creators. Track your favorite channels, automatically surface viral outliers (videos performing unusually well compared to each channel's baseline), study why they worked through AI-powered analysis, and remix their hooks and structure into new scripts tailored to your niche. Built for solo use on your Mac, no hosting required.

## Quickstart

```bash
# 1. Install Node dependencies
npm i

# 2. Configure the environment (every variable is documented in the template)
cp .env.example .env.local
#    -> set IG_SERVICE_TOKEN to any long random string
#    -> set IG_USERNAME / IG_PASSWORD to a THROWAWAY Instagram account (see the
#       ban-risk warning below before you do this)

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

There is no demo data. The app starts empty and fills up with real posts from real
channels you choose to track — the previous `db:seed` command generated fabricated
channels and view counts and has been removed.

## Using Crowsnest

The app starts empty. The workflow:

0. **Connect Instagram** — Settings → Instagram. The sidecar must be running
   (`npm run ig:service`) and credentials must be in `.env.local`. If Instagram issues a
   2FA prompt or a security challenge, the Settings page walks you through it.
1. **Add a channel** — Channels → `+ Channel`, by handle or by profile URL.
2. **Sync** — Channels or the sidebar's "Sync now" pulls the profile plus every post
   from the last `LOOKBACK_DAYS` (default 30), downloads thumbnails to local storage,
   and records real counters (`items_seen`, `items_created`, …) on a `sync_jobs` row.
   Photos, videos and carousels are all captured; carousels keep their individual
   slides as children.
3. **Browse outliers** — the Dashboard and Outlier Feed surface videos performing well
   above their channel's baseline. No key needed.
4. **Analyze** — open a video and hit "Analyze this video" for an AI breakdown of its
   hook, structure, and why it worked. *Needs `ANTHROPIC_API_KEY`.*
5. **Vault** — save a hook or style template from any analyzed video (or write one by
   hand) for reuse. No key needed.
6. **Remix** — the Remix Studio's staged pipeline (Prompt → Research → Hook → Style →
   Script) turns a Vault template (or the source video's own pattern) into a new
   script for your niche. *Needs `ANTHROPIC_API_KEY`* for every generation step; the
   Research stage's auto-assembly is the one step that works keyless.
7. **Export** — "Create Prompt" (Video Detail, the Remix Script stage, or a saved
   script's Vault card) copies a structured markdown prompt to paste into any LLM, as
   a keyless alternative to steps 4/6.

## Available Scripts

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
| `npm run verify:live -- @handle` | Sync a real channel and print the live evidence (see below) |

## Environment Variables

Copy `.env.example` to `.env.local` and fill it in. **Variables are validated at boot**
(`src/server/config.ts`) — the app refuses to start with a missing or malformed required
value instead of failing later on a click.

| Variable | Required | Purpose |
|----------|----------|---------|
| `IG_SERVICE_TOKEN` | **yes** | Shared secret between the app and the Python sidecar |
| `IG_USERNAME` / `IG_PASSWORD` | for sync | Instagram credentials, read by the sidecar only |
| `IG_SESSION_PATH` | no | Persisted session blob (default `data/ig-session.json`, mode 0600) |
| `IG_DEVICE_SEED` | no | Pins the device fingerprint across restarts |
| `IG_PROXY` | no | Proxy DSN for Instagram traffic |
| `IG_SERVICE_URL` | no | Sidecar base URL (default `http://127.0.0.1:8765`) |
| `IG_REQUEST_TIMEOUT_MS` / `IG_DOWNLOAD_TIMEOUT_MS` | no | Per-call timeouts (30s / 120s) |
| `LOOKBACK_DAYS` | no | How far back a sync reaches (default 30) |
| `MAX_ITEMS_PER_SYNC` | no | Safety cap per channel per run (default 200) |
| `MEDIA_ROOT` | no | Local asset storage (default `data/media`) |
| `EAGER_VIDEO_DOWNLOAD` | no | `true` downloads videos during sync instead of on first play |
| `MEDIA_RETENTION_DAYS` | no | Asset prune threshold (default 90) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `CLAUDE_MODEL` | for AI | Analysis + remix |
| `WHISPER_CPP_BIN_PATH` / `WHISPER_MODEL_PATH` | no | Local transcription |
| `CROWSNEST_DB_PATH` | no | SQLite path (default `data/crowsnest.db`) |

### ⚠️ Instagram access: read this before connecting an account

Crowsnest analyses **other creators'** posts. That rules out the official API:
Instagram's Basic Display API was shut down in December 2024, and the Graph API only
reaches accounts you own or that have authorised your app — it cannot enumerate an
arbitrary creator's media. There is no sanctioned way to do what this product does.

So Crowsnest uses [instagrapi](https://subzeroid.github.io/instagrapi/), which drives
Instagram's **private mobile API**. Consequences, stated plainly:

- **It violates Meta's Terms of Service.**
- **Accounts get challenged, rate-limited, and sometimes permanently banned.** Use a
  throwaway account. Never your main one.
- Mitigations are built in — one persistent session (no re-login storms), a pinned
  device fingerprint, jittered pacing, exponential backoff with full jitter on
  `feedback_required`, and optional proxy support — but **none of them are guarantees**.

`services/ig/README.md` has the operational detail, including how to recover from a
challenge.

### Verifying a real sync

Once the account is connected in Settings, one command syncs a real channel and prints
the evidence straight out of the database, off the disk, and off the wire:

```bash
npm run verify:live -- @kallaway
```

It reports the `sync_jobs` row (`items_seen`, `items_created`, `stop_reason`), the stored
posts with their real captions and timestamps, the downloaded assets with real byte
sizes, a `curl -I` (200) and a `Range` request (206) against a genuinely
Instagram-sourced asset, a scan for leaked CDN URLs in the rendered DOM, and a second
consecutive sync proving `items_created = 0` with no duplicated media pks.

It **never logs in itself** — if the sidecar has no session it stops and tells you to
connect in Settings. A script that attempts a blind login is how accounts get
challenged. It also fails loudly on a zero-byte asset or a leaked CDN URL rather than
printing a reassuring summary.

### Local transcription

For keyless local transcription and manual reel import: `brew install yt-dlp whisper-cpp`.
That installs the `whisper-cli` binary only — it does **not** fetch the GGML model file
whisper-cli needs. Download one to the default path (or set `WHISPER_MODEL_PATH`):

```bash
mkdir -p ~/.cache/whisper
curl -L -o ~/.cache/whisper/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

Settings' Local Binaries section shows amber with the exact missing path if this step is
skipped.

## Architecture

- **Stack**: Next.js 16 (App Router, TypeScript) + Tailwind CSS + shadcn/ui
- **Database**: SQLite (better-sqlite3) with Drizzle ORM
- **Instagram data**: a Python sidecar (`services/ig/`) wrapping `instagrapi`, pinned to
  2.18.9, holding one authenticated session. Node talks to it over localhost HTTP with a
  shared-secret header and a timeout on every call.
- **Media**: thumbnails/videos/avatars are downloaded to `MEDIA_ROOT`, content-addressed
  by sha256, and served from `/api/media/<assetId>` with HTTP Range support. Instagram
  CDN URLs expire within hours and are never stored or rendered.
- **yt-dlp**: manual single-reel import by URL (keyless, not part of sync)
- **AI Analysis**: Claude API for video hook/structure analysis and script remixing
- **Transcripts**: Local whisper.cpp (with Metal acceleration) or Groq API fallback

## Core Features

- **Fleets**: Organize channels into named watchlists
- **Outlier Feed**: Filter and sort videos by viral multiplier, timeframe, engagement
- **Video Analysis**: AI-powered breakdown of hooks, structure, and why videos worked
- **Vault**: Save reusable hook and style templates for rapid remixing
- **Remix Studio**: Staged pipeline to transform viral hooks into scripts for your niche
- **Dashboard**: KPI tiles, top outliers, and recently viewed videos

## Documentation

See `docs/` for more information:
- `docs/PLAN.md` — Project goals, architecture, and development phases
- `docs/design/DESIGN.md` — UI system and visual specifications
- `docs/research/FEATURES.md` — Feature prioritization and scout research
- `docs/research/DATA.md` — Data acquisition strategy and provider interfaces
- `docs/superpowers/specs/2026-07-23-crowsnest-design.md` — Complete design specification

## Known Issues

- **Video Detail's not-found status stays 200.** A missing video renders the correct
  not-found *content* in both `next dev` and a production build, but the HTTP status
  code doesn't flip to 404 — a deeper interaction between `generateMetadata` and
  `notFound()` in this Next version, not a missing `notFound()` call. Only matters if
  something external checks the status code; the page itself is correct.
- **Fleet search-within-a-fleet is deferred.** The Feed's Fleet filter scopes to a
  whole Fleet; searching within one for a single channel isn't wired into the Select
  yet, though the query layer (`FeedFilters.channelId`) already supports it.
- **Saved scripts' `hookVaultItemId` is always null.** `remix_sessions` stores the
  chosen hook as raw text, not a `vault_items.id` — there's no column to link a saved
  script back to the specific Vault hook (if any) that seeded it without a schema
  migration adding one.

## Costs

Channel sync is now **free** — it runs through a local Python process against an
Instagram account you supply, with no paid scraping vendor. The cost is paid in risk to
that account rather than in dollars (see the warning above).

The only paid integration left is Claude API usage for analysis and remix generation,
and even that is optional (the "Create Prompt" export is a keyless alternative). Local
transcription (whisper.cpp) and manual reel import (yt-dlp) are free.

## Development

This is a strict TypeScript project. Before committing, ensure:

```bash
npm run build  # Must succeed
npm run test   # Full suite must pass
npm run lint   # No ESLint errors
git status     # Working tree clean
```

## License

Private project.
