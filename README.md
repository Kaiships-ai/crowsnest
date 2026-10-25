# Crowsnest

**Find what's going viral. Understand why. Make your next video.**

Crowsnest is Lead Studio, a local-first Electron app for short-form video creators. It tracks
creators, finds the posts that beat a creator's own baseline (outliers), and runs the loop
from numbers to plan to cooked reel to publish, with Claude or Codex as the reasoning brain
over MCP.

**Runs locally on your Mac. No hosting. No subscription. Your research stays yours.**

`Local-first` · `macOS` · `Electron` · `SQLite` · `MCP` · `Private project`

## What is in this repo

One app with one toolchain (pnpm, node 24):

| Part | Where |
|------|-------|
| The app shell and workspace (terminal, chat, browser tab, split panes, agents), from a one-time copy of Orca | `src/main/`, `src/renderer/`, `src/preload/`, `src/shared/`, `src/cli/`, `config/` |
| crowsnest's server: data, jobs, MCP, media, run inside the app's main process | `src/server/`, `src/lib/`, `drizzle/` |
| The Instagram sidecar (Python, `instagrapi`) | `services/ig/` |
| The `kai` CLI for the packaged Kit | `src/kai-cli/`, `packaging/` |

The app opens `data/crowsnest.db` of the checkout it runs from, serves the MCP on a free
127.0.0.1 port (written to `<userData>/mcp.port`), and serves stored media as `cn-media:`.
Sync and own-channel measurement run in the app. The publish scheduler runs only with
`LEAD_STUDIO_PUBLISH_JOBS=1`.

## Installation

```bash
# 1. Node 24 and pnpm (Homebrew)
brew install node@24
export PATH=/opt/homebrew/opt/node@24/bin:$PATH

# 2. Install dependencies
pnpm install

# 3. Configure the environment (every variable is documented in the template)
cp .env.example .env.local
#    -> set IG_SERVICE_TOKEN to any long random string
#    -> set IG_USERNAME / IG_PASSWORD to a THROWAWAY Instagram account
#       (read the Instagram access warning below first)

# 4. Set up the database and its built-in presets
pnpm run db:migrate
pnpm run db:bootstrap

# 5. Install and start the Instagram sidecar (Python 3.12, managed by uv)
cd services/ig && uv sync && cd ../..
pnpm run ig:service

# 6. Open the app
pnpm dev
```

Claude Code reaches the app's MCP through the `lead-studio` entry in `.mcp.json`.

## Configuration

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

## ⚠️ Instagram access

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

## AI and local transcription

**Claude** (or Codex), connected over MCP, writes video analysis and the remix hook, outline,
and script. The app holds no model key.

**Local Whisper** (`whisper.cpp`, with Metal acceleration; Groq API as a fallback) powers
keyless transcription. For transcription and manual reel import:

```bash
brew install yt-dlp whisper-cpp
mkdir -p ~/.cache/whisper
curl -L -o ~/.cache/whisper/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

## Development

Before committing, all of these pass under node 24 and the working tree stays clean:

```bash
pnpm run build      # the Electron app
pnpm test           # every vitest project; crowsnest's alone: pnpm test --project crowsnest
pnpm run lint       # oxlint and the repo's ratchets
pnpm run typecheck  # the app's projects and config/tsconfig.crowsnest.json
```

Locally, run only the tests your change touches with `pnpm run test:changed`. CI runs only the
affected tests; nothing runs the full suite. Heavy jobs go through `scripts/heavy.sh`, one at a time per machine. Prove behavior in
the real app with the `verify` skill (`.claude/skills/verify/SKILL.md`): `app-up.sh --seed`,
`app-drive.sh <journey>`, `app-down.sh`.

General workflow runs on [pstack](https://github.com/michael-denyer/pstack-claude): start a
task with `/poteto-mode`. Agent rules are in `AGENTS.md` (included by `CLAUDE.md`).

## Documentation

Product requirements live in `PRODUCT.md` and the design system in `DESIGN.md`. Architecture
pages, decisions, and running plans live under `documents/`, rendered as an mkdocs-material
site (`mkdocs serve`).

| Directory | Contents |
|-----------|----------|
| `documents/index.md` | The doc index |
| `documents/architecture/` | How it is built: `overview.md` plus one page per part |
| `scripts/e2e/cases/` | Each part's built-feature list and test cases |
| `documents/plans/` | Plans still being worked on |
| `documents/decisions/` | Decisions still in force |

Packaging detail: `documents/architecture/kit.md` and `packaging/CHANGELOG.md`.

## License

Private project. The workspace code under `src/main/`, `src/renderer/`, `src/preload/`,
`src/shared/` and `src/cli/` comes from Orca; see `LICENSE`.
