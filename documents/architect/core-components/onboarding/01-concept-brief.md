# onboarding: concept brief

`documents/architect/core-components/onboarding/`

Status: shipped and in daily use. The two `kai kit init` secret prompt defects (an empty `IG_PASSWORD`, a plaintext `ANTHROPIC_API_KEY` echo) are fixed, and credential entry has moved into the dashboard with live validation: a username/password Instagram login validates against a real sidecar before it saves anything, the packaged sidecar's launchd job now carries those credentials into its own environment, and AI features fall back to calling Anthropic directly when a valid key is configured but the local LLM proxy is not running.

## 1. What it is

Onboarding is what happens between `kai up` opening a browser and the user reaching a working feed. It is two halves that never share code, joined only by the `.env.local` the first half writes and the `app_settings.first_run_completed` flag the second half sets. The terminal half is the Kit CLI's `kai kit init` (`src/cli/kai.ts`, `cmdKitInit`): it writes `.env.local`, prompts for the Instagram account (a username and a masked password), generates the sidecar's shared secret, optionally takes an `ANTHROPIC_API_KEY`, asks where the vault lives, then creates the database and hands off to `kai up`. The in-app half is a five screen flow served at its own route, `/first-run` (`src/app/first-run/`), outside the normal app shell, no sidebar, no topbar: welcome, a niche and focus question, connect (the one real credential screen, wired to Instagram login including its two factor and challenge branches), sources (adding tracked channels), and first sync. A route guard, `shouldRedirectToFirstRun` in `src/server/queries/first-run-gate.ts`, sends a database with no channels tracked and the first run flag not yet set to this route before any other page renders; once a channel exists or the flag is set, it never redirects there again, even if every channel is later removed.

Settings also carries two related panels once onboarding is behind the user: the Instagram connection panel (the same login and disconnect surface the connect step uses, reachable again later if the session needs re establishing) and the local binaries check (yt-dlp, whisper-cli plus its model file), a read only status list for the optional local transcription path.

## 2. Why it exists

A buyer with the Kit installed but nothing configured cannot use crowsnest at all: there is no data until a channel is tracked, and no channel can be usefully synced until the Instagram sidecar has a session. Onboarding exists to take a completely empty install to a dashboard with at least one tracked channel and a first sync underway, and to do it once. The first run gate exists specifically so a real production database is never routed back into a wizard by mistake.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| `kai kit init` | The terminal command (`cmdKitInit` in `src/cli/kai.ts`) that writes `.env.local`, prompts for Instagram credentials and an optional Anthropic key, creates the database, and starts the app. Requires a cached license from an earlier `kai login`. |
| Masked prompt (`ask(..., { secret: true })`) | The one shared prompt helper in `src/cli/kai.ts`. Its secret path reads a line with the terminal in raw mode (`readSecretLine`), so typing is never echoed, and pairs `IG_USERNAME` with `IG_PASSWORD` through `checkPairedIgCreds` so neither saves alone. |
| The first run gate | `shouldRedirectToFirstRun` in `src/server/queries/first-run-gate.ts`, called from `src/app/(shell)/layout.tsx` before any other read. Compound on purpose: `!firstRunCompleted && !hasChannels`. |
| `first_run_completed` | The `app_settings` flag that ends first run. Written by "Open Crowsnest" and "Skip setup for now" alike, through the generic `updateAppSettingsAction`, and cleared by Settings' "Replay first run" control. |
| `/first-run` flow | The five screen client flow (`src/components/first-run/`): an unnumbered welcome plus `01 FOCUS`, `02 INSTAGRAM`, `03 CHANNELS`, `04 FIRST SYNC`. Step order and state live in memory (`useState`), not the URL. |
| Connect step | The one real credential screen (`connect-step.tsx`). Signs in through the same Instagram sidecar surface Settings' Instagram section uses; shows only the connected handle, never a follower or post count, because the status action carries no such fields. |

## 4. How it fits in the system

Onboarding sits in front of the whole app, not beside it. The `(shell)` layout's route guard is the only thing that forces a fresh install through `/first-run`, and every other core loop page, the feed, channels, the vault, is unreachable until the gate passes. The terminal half exists because the Instagram sidecar needs credentials on disk before the server can even reach it; the in-app half exists to get an empty install to a tracked channel and a first sync. Once a channel is tracked and the flag is set, onboarding hands off entirely: the feed, ig-sync, and the rest of the app take over, and onboarding has no further role except the Settings replay control.

## 5. Dependency map

### Upstream (what onboarding depends on)

| Dependency | Why |
| --- | --- |
| Cached license (`~/.kai/entitlement.json`, from `kai login`) | `cmdKitInit` refuses to run without one. |
| `.env.example` / `.env.local` | The terminal half copies or edits this file directly; it is the only artifact the two halves share. |
| SQLite database via drizzle (`app_settings`, `channels`) | The gate reads both; the flow's steps write into both through shared actions. |
| Instagram sidecar (owned by [ig-sync](../ig-sync/01-concept-brief.md)) | The connect step signs in through it; the first sync step runs a real sync against it. |
| Shared server actions (`saveNicheSettingsAction`, `igLoginAction`, `igLoginWithCredentialsAction`, and their shared two factor and challenge branches, `addChannelAction`, `startSyncAction`, `updateAppSettingsAction`) | Every step in the flow writes through an action another component already owns; onboarding introduces no new action of its own. |
| Shared sync UI (`useSyncProgress`, `<SyncProgressPanel>`) | The first sync step reuses the same progress panel the Channels page and Settings show, not a copy. |
| `node`/`tsx` and the migration and bootstrap scripts | `cmdKitInit` runs `src/server/db/migrate.ts` and `src/server/db/bootstrap.ts` directly to create and seed the database. |

### Downstream (what depends on onboarding)

| Consumer | What it reads |
| --- | --- |
| `(shell)` layout and every core loop page | Blocked entirely until the gate passes; the gate is the one thing standing between a fresh install and the rest of the app. |
| [feed](../feed/01-concept-brief.md), [ig-sync](../ig-sync/01-concept-brief.md) | Have nothing to show until onboarding tracks at least one channel and runs a first sync. |
| Settings' Onboarding section (`onboarding-section.tsx`) | Reads and clears the same `first_run_completed` flag onboarding owns, to replay the flow. |
| Get started checklist (`(shell)/layout.tsx`) | Its "Finish setup" item reads `gate.firstRunCompleted` directly. |

### External

| Dependency | Role |
| --- | --- |
| Node.js `readline` (built in) | Powers `ask()`'s terminal prompts, including the secret path where both known defects live. |
| Instagram, reached only through the sidecar | Onboarding never talks to Instagram directly; the connect step drives the same sidecar [ig-sync](../ig-sync/01-concept-brief.md) owns. |

## 6. Boundaries

Onboarding owns the first run gate, the five screen `/first-run` flow, and the CLI's `kai kit init` prompts; it hands off to the feed and the rest of the app once a channel is tracked and the flag is set. It does not own ongoing Instagram session management day to day, that panel lives in Settings and is shared with the connect step rather than owned separately by either. It does not own the Instagram sidecar itself, that is [ig-sync](../ig-sync/01-concept-brief.md)'s. It does not own the Graph API token for the user's own channel: that panel was proposed but never built, there is no Graph API code path in the app today, and the burner Instagram identity the sidecar reads and any future Graph token must never share code or an environment variable prefix.

ENH-1, tracked in the GitHub backlog (label `backlog`), is done: credential entry now lives in the dashboard with live validation, and AI features work as soon as a valid key exists. A burner Instagram username and password can be entered from Settings' "API keys & secrets" panel or the first-run connect step and are validated against a real sidecar login (`igLoginWithCredentialsAction`) before anything is saved, reusing the same two-factor and challenge branches the other login paths already share. That credential pair now also reaches the sidecar a real buyer runs: the launchd job in `src/cli/service-darwin.ts` injects `IG_SERVICE_TOKEN`, `IG_USERNAME`, `IG_PASSWORD`, `IG_PROXY`, and `IG_DEVICE_SEED` from the secrets store into the plist's own `EnvironmentVariables`, the same shape `src/server/sidecar/control.ts`'s `uv`-dependent dev launcher already used. And `getLlm()` in `src/server/llm/client.ts` no longer treats `LLM_BASE_URL` being set as reason enough to route through the proxy: it calls `routerReachable()` first and falls back to calling Anthropic directly whenever a valid key exists but nothing answers at that address. Three small residuals from this work stay open in the backlog (ENH-2 through ENH-4): the dashboard's AI status badge can still say "routed through proxy" after a call has fallen back to a direct connection, since the badge is derived from `LLM_BASE_URL` being set rather than from `getLlm()`'s live decision; Settings' Instagram section lets the session-token and username/password forms submit at once instead of sharing one busy flag; and one credentials-login branch can write the secrets store twice and leave a stale password in its input field after a failed challenge.
