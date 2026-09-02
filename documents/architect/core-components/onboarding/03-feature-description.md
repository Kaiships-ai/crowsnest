# onboarding: feature description

Onboarding is what happens between a fresh install and a working feed. It has two halves that never share code: a terminal setup step, `kai kit init`, that writes config, creates the database, and starts the app, and a five screen in-app flow at `/first-run` that a route guard forces a fresh install through before any other page renders. This document describes the flow as shipped today, plus two enhancements in progress: moving credential entry into the dashboard with live validation (section 5, tracked as `ENH-1` in [05-backlog-to-enhance.md](05-backlog-to-enhance.md)), and making AI features work as soon as a valid key exists instead of depending on a proxy the installer never sets up (section 6). Both are partially built; each section below states plainly what already works and what does not.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Set up crowsnest in the terminal | `kai kit init` writes `.env.local`, prompts for Instagram credentials and an optional Anthropic key, creates the database, and starts the app | ● | `src/cli/kai.ts` (`cmdKitInit`) | none — ONB-1/ONB-2 fixed, see 05-backlog-to-enhance.md |
| 3 | Complete first run in the app | A five screen flow takes a fresh install to a tracked channel and a first sync underway | ● | `src/app/first-run/`, `src/components/first-run/` | none |
| 4 | Replay first run | A Settings control clears the flag and sends the user back through the flow without deleting anything | ● | `src/components/settings/onboarding-section.tsx` | none |
| 5 | Live-validated in-dashboard credentials | Set the Anthropic key and Instagram credentials from the dashboard instead of a blind terminal prompt, with a real check before you rely on them | ◐ | `src/components/settings/secrets-section.tsx`, `src/components/settings/instagram-section.tsx`, `src/components/first-run/connect-step.tsx` | ENH-1 |
| 6 | AI works out of the box, or degrades cleanly | A valid Anthropic key should be enough to use analysis, similar, and remix; no key should show a clear "add a key" state; neither should ever look like a broken proxy | ◐ | `src/server/llm/client.ts`, `src/components/status/dependency-status.ts`, `src/components/remix/generation-blocked.tsx` | no key needed / proxy running for full behavior; see section 6 |

## 2. Set up crowsnest in the terminal

### Who uses it

The buyer, once, from a terminal, right after `kai login`.

### What it does

`kai kit init` requires a cached license, then writes `.env.local`: it prompts for the Instagram account the sidecar will drive (`IG_USERNAME`, then a masked `IG_PASSWORD` asked only if a username was given), generates `IG_SERVICE_TOKEN` automatically if the file still holds the placeholder, prompts for an optional masked `ANTHROPIC_API_KEY`, and asks where the vault lives (defaulting to `~/.crowsnest/vault`, creating the directory). It writes `.env.local` at mode `0600`, runs the database migrations and bootstrap, and hands off to `kai up`, which brings the dashboard up at `http://localhost:3000`.

### How to access it

The `kai kit init` command, run from a terminal after `kai login <license-key>`.

### Business rules

- Refuses to run without a cached entitlement, dying with a pointer to run `kai login` first.
- `IG_PASSWORD` is asked only when `IG_USERNAME` was given.
- `IG_SERVICE_TOKEN` is generated automatically only if the file still holds the `change-me` placeholder.
- Re running edits an existing `.env.local` in place rather than overwriting it, keeping surrounding keys and comments.
- `.env.local` is written mode `0600` and `chmod`'d again after, because it holds the Instagram password.

### Limitations

- **Fixed: the masked `IG_PASSWORD` prompt used to save an empty value on a real terminal** (`ONB-1`, was a blocker, now done — see `05-backlog-to-enhance.md`). The username saved, but the masked password read came back empty, so `.env.local` got `IG_PASSWORD=`, and the Instagram sidecar refused to start. Kept here as history: this was the failure mode a re-regression in `ask`'s secret path would reproduce.
- **Fixed: the `ANTHROPIC_API_KEY` prompt used to echo the key in plaintext** (`ONB-2`, was medium severity, now done). The same masked prompt code failed to suppress the echo on a real terminal; the key was entered and saved correctly, but was visible on screen and landed in scrollback.

### User guide

Run `kai kit init` in a terminal once you have a license. It creates a config file, asks for the Instagram account crowsnest will sign in as (use a throwaway account, never one you care about), optionally takes an Anthropic API key for AI analysis and the Vault pipeline, and asks where to keep your vault of saved scripts. It then sets up the database and opens crowsnest in your browser.

## 3. Complete first run in the app

### Who uses it

Any user whose database has no channel tracked and the first run flag unset. Redirected here automatically by the app shell before any other page renders.

### What it does

A five screen flow, an unnumbered welcome plus `01 FOCUS`, `02 INSTAGRAM`, `03 CHANNELS`, `04 FIRST SYNC`, that takes an empty install to at least one tracked channel and a first sync underway. Each step saves through an existing server action as it is passed, so the answers are already persisted before the next screen appears; reloading mid flow re lands on welcome but loses nothing already saved. A persistent "Skip setup for now" control in the left aside is available throughout.

### How to access it

Automatically, redirected in by the `(shell)` layout on a fresh install. Once first run is finished, the only supported way back is Settings' "Replay first run" (see [4. Replay first run](#4-replay-first-run)); navigating directly to `/first-run` otherwise sends the user straight back to the dashboard.

### Business rules

- The gate is compound on purpose: not `firstRunCompleted` and no channels tracked. A database that already has a channel, or that has the flag set, is treated as done and never redirected, even if every channel is later removed.
- The left rail shows the four numbered steps. A step already passed is clickable to go back; the current step is marked; anything ahead is locked until the step in front of it is done.
- **01 FOCUS** saves the picked niche through `saveNicheSettingsAction`, the same `niche_profile` setting Settings' Niche Profile section reads and writes.
- **02 INSTAGRAM** signs in through the same `getIgStatusAction` / `igLoginAction` surface Settings uses. A wrong two factor or challenge code stays on the same field, focused, with an inline error, rather than falling through to a generic error view. When connected, the screen shows only the connected handle, `@username`, and nothing else, no follower or post count, because the status action carries no such fields. "Skip for now" always advances regardless of connection state.
- **03 CHANNELS** is a handle in, handle out list: the user types or pastes one or several handles, and Continue commits the whole list through `addChannelAction` (idempotent per handle, so re pressing Continue after a partial failure is safe). Nothing is a tracked channel until Continue is pressed. Only a malformed handle is bounced; a well formed handle that cannot currently be verified (sidecar down or logged out) is still added, to be checked on the first sync.
- **04 FIRST SYNC** runs the shared sync progress panel, `useSyncProgress` / `<SyncProgressPanel>`, scoped to exactly the channels just added, the same panel the Channels page and Settings use. "Open Crowsnest" becomes available the moment the run reaches any terminal status, success, partial, or failed, not only a clean success. Pressing it sets `first_run_completed` and hands off to the shell, which reads the same sync record and shows the failure strip itself if the run did not fully succeed.
- "Skip setup for now" writes `first_run_completed` the same way and is available from every step; it loses nothing already answered, since each step persists independently.

### Limitations

- A buyer who hits `ONB-1` (the empty `IG_PASSWORD` defect in the terminal setup feature above) reaches this flow fine, but the connect step, and every later sync, reports the local Instagram service isn't running, because the sidecar never came up. The flow itself gives no earlier sign that the password was lost; the failure only surfaces here.
- No Graph API connect path exists for the user's own channel; that panel was proposed but never built. See [01-concept-brief.md](01-concept-brief.md).
- Skipping is available on every step, so a user can reach the dashboard with no channel and no sync at all; the flow only guarantees the opportunity, not the outcome.

### User guide

When you open crowsnest for the first time, you land on a short setup flow before you see the dashboard. Click Get started, tell crowsnest what kind of content you make, then connect your Instagram account, the account crowsnest signs in as to read other creators' posts, never used to post on your behalf. Add the Instagram handles of the accounts you want to track, one at a time or pasted as a list, then run your first sync. You can leave at any point with Skip setup for now, and anything you already answered is kept; Settings can bring this flow back later if you want to see it again.

## 4. Replay first run

### Who uses it

Any user, from Settings, once first run is behind them.

### What it does

A button in Settings' Onboarding section clears `first_run_completed` (through the same `updateAppSettingsAction` every other Settings row uses) and navigates straight to `/first-run`, bypassing the `(shell)` gate's own decision so it works even on a database that already has channels tracked.

### How to access it

Settings, Onboarding section, "Replay first run" button, confirmed through a dialog.

### Business rules

- Clearing the flag does not delete any data: channels already added, the niche profile, and the Instagram session all stay as they are.
- Navigates directly to the flow's own route rather than through the shell's gate, so replaying works regardless of how many channels are already tracked.

### Limitations

- None beyond the flow itself; once replayed, the same first run behavior and limitations described above apply again.

### User guide

If you want to see the first run setup again, for example to add more channels the same way or double check your niche, open Settings and click Replay first run under Onboarding. It only resets the setup flag; nothing you already set up is deleted.

## 5. Live-validated in-dashboard credentials

### Who uses it

Any buyer who needs to set or fix the Anthropic key or an Instagram credential after the initial `kai kit init`, without going back to a terminal.

### What it does

`kai kit init`'s terminal prompts (section 2) are a blind write: they never attempt a real login or a real API call, so a wrong Instagram password or an invalid Anthropic key is accepted silently and only surfaces later, as a dead sidecar or a failed generation. This feature is the dashboard-side fix, and part of it is already built.

Settings' "API keys & secrets" panel (`src/components/settings/secrets-section.tsx`) lets `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, and the Instagram-related values be set or cleared from the browser. A value saved there is stored in the local database and read back db-first, env-fallback (`getSecret`, `src/server/secrets/store.ts`), so a new Anthropic key takes effect on the very next AI call with no restart: `getLlm()` reads it through `getSecret`, and every save resets the cached client. That panel's Anthropic row also carries a "Test" button that runs a real, free `count_tokens` call (`testAnthropicKeyAction`, `LlmClient.ping()` in `src/server/llm/client.ts`) and reports success or the exact failure, wrong key, network error, and so on, immediately. Settings' Instagram connection panel goes further for one login path: "Sign in with a session token" (`src/components/settings/instagram-section.tsx`) takes a `sessionid` cookie pasted from an already-logged-in browser and makes a real sidecar login attempt the moment Connect is pressed, surfacing success, a two-factor prompt, a security challenge, or a failure right there, never a blind write.

Username-and-password Instagram login does not get the same treatment yet. Both `/first-run`'s connect step (`src/components/first-run/connect-step.tsx`) and Settings' own "Connect" button call `igLoginAction()`, which takes no username or password argument by design, its own module doc calls this rule 2, "no action ever accepts a password", and instead tells the sidecar to sign in with whatever `IG_USERNAME`/`IG_PASSWORD` are already sitting in its own process environment. Neither screen has a field to type a username or password: if the sidecar has no credentials configured, both tell the user to edit `.env.local` directly and restart the sidecar in a terminal, the same blind-write path this feature exists to replace. Setting `IG_USERNAME`/`IG_PASSWORD` through the "API keys & secrets" panel does not close that gap either: the sidecar's background-service definition passes it no environment variables at all (`src/cli/service-darwin.ts`), and the Python sidecar reads its username and password only from `.env.local` at its own process start (`services/ig/crowsnest_ig/config.py`), never from the app's database-backed secret store. So a value saved there for `IG_USERNAME` or `IG_PASSWORD` shows as "Configured, set here" without ever reaching a real login attempt, until someone also edits `.env.local` and restarts the sidecar by hand.

### How to access it

Settings > API keys & secrets, for the Anthropic key (save, then a separate manual Test), the Groq key, and the two Instagram credential rows (save only, not live-validated). Settings > Instagram connection, for the session-token path (live-validated on Connect) and the env-based "Connect" button. `/first-run`'s 02 INSTAGRAM step, for the same env-based "Connect Instagram" button, with no field to type a username or password.

### Business rules

- A secret saved through "API keys & secrets" is read db-first, env-fallback; for the Anthropic key this takes effect on the very next call, since saving resets the cached LLM client.
- The Anthropic key's "Test" is a manual, separate action from Save; nothing currently blocks a save on a failed test.
- The session-token Instagram path is a real login attempt at the moment Connect is pressed; a wrong or expired sessionid comes back as the sidecar's own error, never stored as if it worked.
- `IG_USERNAME`/`IG_PASSWORD` saved as managed secrets are shown as configured in Settings but are not read by the sidecar process, which only reads its own `.env.local` at boot.
- `kai kit init`'s terminal prompts (section 2) remain the only way most buyers set the sidecar's actual `IG_USERNAME`/`IG_PASSWORD`; the dashboard has no path today that both accepts a typed password and gets it into the sidecar's environment.

### Limitations

- Neither `/first-run` nor Settings has a username/password field wired to a live sidecar login attempt; for that credential pair, the terminal prompt is not superseded yet.
- The Anthropic key's live check is opt-in and after the fact, not a gate before save.
- Saving `IG_USERNAME`/`IG_PASSWORD` in the dashboard creates a "Configured" state that does not describe what the sidecar will actually try on its next login.
- Tracked as `ENH-1` in [05-backlog-to-enhance.md](05-backlog-to-enhance.md).

### User guide

You can add or replace your Anthropic API key any time from Settings, under API keys & secrets, and press Test to confirm crowsnest can reach Claude with it before you rely on it. The same panel shows whether your Instagram username, password, and session values are configured, but changing the username or password there does not by itself change what the Instagram sidecar signs in with. The most reliable way to connect Instagram from the dashboard today is Settings' Instagram connection panel, "Sign in with a session token": paste the `sessionid` cookie from a browser you're already signed into that account with, and crowsnest checks a real login the moment you press Connect, telling you immediately if it worked.

## 6. AI works out of the box, or degrades cleanly

### Who uses it

Every buyer, from the moment they open the dashboard, whether or not they have configured an Anthropic key.

### What it does

Every AI feature, analysis, the similar panel, and the Remix studio, goes through one client (`src/server/llm/client.ts`). `.env.example` sets `LLM_BASE_URL=http://localhost:20128`, a local 9router proxy the Kit installer does not install, and `kai kit init` copies `.env.example` into every fresh `.env.local` without touching that line. `isCompatMode()` is simply whether `LLM_BASE_URL` is set at all, so that one default alone routes every AI call through the local proxy address whether or not anything is listening there, and independently of whether an Anthropic key is configured.

With no key configured, the app already degrades cleanly. `getLlm()` throws before any network call, and every server action that calls it turns that into a specific, friendly message, "Add ANTHROPIC_API_KEY in Settings to enable analysis" and the same for remix generation, rather than a raw error. The Remix studio swaps in a dedicated blocked panel (`src/components/remix/generation-blocked.tsx`) with a "no-key" reason and a direct link to Settings, and the dashboard's dependency status panel (`src/components/status/dependency-status-panel.tsx`) reports the model backend as having no key configured rather than trying to test one. The core loop, the feed, outliers, browsing channels, and the Create Prompt export, never touches this at all: `kai kit init` itself says so ("Skip it and the Create-Prompt export still works keyless"), and the export action carries no dependency on the LLM client.

With a key configured but no 9router actually running at that address, the result today is not "AI just works." Requests still go to the dead default proxy and fail as a connection error, mapped to "Network error reaching Claude." What is built is a clean, specific failure rather than a raw crash: the dependency status panel classifies this into distinct states, unreachable, answered but every attempt failed, or answered but generation unconfirmed, each with its own headline (`src/components/status/dependency-status.ts`); the Remix studio's blocked panel names the exact address nothing answered and points at a terminal fix; and Settings carries a 9router section (`src/components/settings/router-section.tsx`) that can Start, Restart, Stop, or Check the local proxy, plus an "Auto-manage" toggle, off by default, that starts or restarts it automatically once status is read, provided the `9router` binary is already installed on the machine. None of this makes generation succeed without 9router; it keeps the failure legible, and gives a button instead of a terminal command if 9router happens to already be installed.

Making AI work automatically as soon as a valid key exists, without requiring a separate 9router install, is not built. Whether that means calling Anthropic directly when no working proxy is present, auto-provisioning 9router, or something else is an implementation decision for a later pass and is out of scope here. The behavior this section commits to is: a valid key with no 9router running should let analysis, similar, and remix work; the complete absence of a key should show the "add a key" state above; and the keyless core loop, feed, outliers, browse, Create Prompt export, should never be blocked by either state.

### How to access it

Automatic; there is no setting a buyer flips to choose a direct connection over the proxy today, since only the proxy path exists. The no-key and proxy-down states appear wherever an AI feature lives (feed similar, video analysis, the Remix studio) and are summarized on the dashboard's dependency status panel; Settings' 9router section is the one manual recovery control.

### Business rules

- Any non-empty `LLM_BASE_URL` forces proxy mode, reachable or not; there is no fallback to a direct Anthropic connection while it is set.
- Whether a key is configured and whether the configured backend can be reached are checked and reported separately; a key being present says nothing about whether the proxy is up.
- The dependency status panel treats a proxy that answers with an error as a different, more specific state than a proxy nothing answers at.
- The keyless core loop, feed, outliers, browse, Create Prompt export, is never gated on a key or on proxy mode.

### Limitations

- A valid key with no 9router running does not yield working AI features today; it yields a clearly labeled blocked state instead. Closing that gap is this feature's open item.
- The 9router Start/Auto-manage controls in Settings require the `9router` binary to already exist on the machine; neither one installs it.
- No backlog id exists yet for "AI works with a key and no 9router"; this section is the open behavior contract for that gap, not a fact yet true of the running app.

### User guide

crowsnest's AI features, analysis, the similar panel, and the Remix studio, need a Claude API key. Without one, those screens tell you plainly that a key is missing and link straight to Settings; nothing else in the app, your feed, outliers, browsing channels, or exporting a Create Prompt, is affected. Today, having a key alone is not always enough: if the local model proxy those features route through isn't running, they show a clear "the local proxy isn't answering" state instead of quietly failing, and Settings' 9router section can start or restart that proxy for you if it is already installed on your machine.

## 7. Interactions with other systems

Persistence. Each step persists independently, the niche in `app_settings`, the Instagram session in the sidecar, the channels as `channels` rows, the sync as a `sync_jobs` row, so step order in the UI carries no state of its own beyond `first_run_completed`.

The gate and the shell. The `(shell)` layout's route guard is the only thing that forces a fresh install into `/first-run`, and the failure strip it renders after first run reads the same sync record the first sync step produced. See [shared/navigation-and-shell.md](../../shared/navigation-and-shell.md).

Settings. Several panels carry related surfaces once onboarding is behind the user: the Instagram connection panel (the same login and disconnect surface the connect step uses, plus the session-token path and 9router controls covered in sections 5 and 6), the "API keys & secrets" panel where the Anthropic key and Instagram credentials are set from the dashboard, and a read only local binaries check (yt-dlp, whisper-cli and its model). Settings' "Replay first run" clears `first_run_completed` to bring the flow back.

External services. The Instagram sidecar, owned by [ig-sync](../ig-sync/01-concept-brief.md), is the one service the flow drives directly, for login and the first sync. The local 9router proxy, when `LLM_BASE_URL` points at it, is what analysis, similar, and remix actually talk to; see section 6. The Anthropic key can be entered either by `kai kit init` in the terminal or from Settings' "API keys & secrets" panel (section 5); either way it is consumed by analysis and the Vault pipeline later.

## 8. Edge cases

- A buyer who hits `ONB-1` finishes `kai kit init` successfully and reaches the dashboard, but the sidecar is dead, so the connect step (and every later sync) reports the service down. The onboarding flow itself gives no earlier sign that the password was lost.
- The connect step shows only the connected handle, never a follower or post count, because the app's Instagram status carries no such fields.
- Adding a handle while the sidecar cannot verify it does not reject the handle; it is tracked and checked on the first sync. Only a malformed handle is bounced.
- "Open Crowsnest" appears on any terminal sync status, including a failed one, because a cold first sync failing is expected and the app is usable regardless.
- Skipping is available on every step, so a user can reach the dashboard with no channel and no sync at all; the flow only guarantees the opportunity, not the outcome.
