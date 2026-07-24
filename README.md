# Crowsnest

Crowsnest is a personal, local-first research tool for short-form video creators. Track your favorite channels, automatically surface viral outliers (videos performing unusually well compared to each channel's baseline), study why they worked through AI-powered analysis, and remix their hooks and structure into new scripts tailored to your niche. Built for solo use on your Mac, no hosting required.

## Quickstart

```bash
# 1. Install dependencies
npm i

# 2. Set up the database
npm run db:migrate

# 3. Populate with demo data
npm run db:seed

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to get started.

## Using Crowsnest

The demo seed data lets you explore every page immediately, keyless. The real workflow,
once you're ready to track your own channels:

1. **Add a channel** — Channels → `+ Channel`, track by handle. This just starts
   tracking; it works with no keys set (the row appears with placeholder stats).
2. **Sync** — Channels or the sidebar's "Sync now" pulls real profile/reel data for
   every tracked channel. *Needs `APIFY_TOKEN`* (or `HIKERAPI_KEY` as a fallback) — with
   neither set, Sync now still runs and reports a clear "no provider configured" gap
   per channel instead of failing silently.
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
| `npm run db:seed` | Populate database with demo seed data |

## Environment Variables

All variables are **optional**. The app works keyless with seeded demo data and local transcript analysis.

| Variable | Purpose | Example |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Claude API key for video analysis and script remix | `sk-ant-v7-...` |
| `APIFY_TOKEN` | Apify token for channel sync (primary provider) | `apify_api_...` |
| `APIFY_ACTOR_ID_IG_PROFILE` | Override the Apify actor used for profile fetches (default: `apify/instagram-profile-scraper`) | `apidojo/instagram-profile-scraper` |
| `APIFY_ACTOR_ID_IG_REEL` | Override the Apify actor used for recent-reels fetches (default: `apify/instagram-reel-scraper`) | `apidojo/instagram-reel-scraper` |
| `GROQ_API_KEY` | Groq API key for transcript analysis fallback | `gsk_...` |
| `HIKERAPI_KEY` | HikerAPI key for channel data fallback | `hiker_...` |
| `WHISPER_CPP_BIN_PATH` | Path to the `whisper-cli` binary for local transcription (default: resolved from PATH) | `/opt/homebrew/bin/whisper-cli` |
| `WHISPER_MODEL_PATH` | Path to the whisper.cpp GGML model file (default: `~/.cache/whisper/ggml-large-v3-turbo.bin`) | `/path/to/ggml-large-v3-turbo.bin` |
| `CLAUDE_MODEL` | Claude model to use (default: `claude-sonnet-5`) | `claude-opus-4-8` |
| `CROWSNEST_DB_PATH` | Custom SQLite database file path | `/path/to/db.sqlite` |

For keyless local transcription and manual reel import: `brew install yt-dlp whisper-cpp`.

## Architecture

- **Stack**: Next.js 16 (App Router, TypeScript) + Tailwind CSS + shadcn/ui
- **Database**: SQLite (better-sqlite3) with Drizzle ORM
- **Data Providers**: Apify (primary), HikerAPI (fallback), yt-dlp (manual URL import, keyless)
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

Everything in this app is free to run except two optional integrations you opt into
per-feature: Claude API calls (analysis, remix generation) and channel-sync providers
(Apify/HikerAPI). Estimated all-in monthly cost at moderate personal-use volume:
**~$10–25/month** — see `docs/research/DATA.md` for the full breakdown and sourcing.
Local transcription (whisper.cpp) and manual reel import (yt-dlp) are always free.

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
