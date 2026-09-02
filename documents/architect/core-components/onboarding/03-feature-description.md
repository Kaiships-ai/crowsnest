# onboarding: feature description

Onboarding is what happens between a fresh install and a working feed. It has two halves that never share code: a terminal setup step, `kai kit init`, that writes config, creates the database, and starts the app, and a five screen in-app flow at `/first-run` that a route guard forces a fresh install through before any other page renders. This document describes the flow as shipped today; the dashboard redesign (moving Instagram login and key entry into the dashboard with live validation) is tracked as `ENH-1` in [05-backlog-to-enhance.md](05-backlog-to-enhance.md) and is not built.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Set up crowsnest in the terminal | `kai kit init` writes `.env.local`, prompts for Instagram credentials and an optional Anthropic key, creates the database, and starts the app | ◐ | `src/cli/kai.ts` (`cmdKitInit`) | ONB-1, ONB-2 |
| 3 | Complete first run in the app | A five screen flow takes a fresh install to a tracked channel and a first sync underway | ● | `src/app/first-run/`, `src/components/first-run/` | none |
| 4 | Replay first run | A Settings control clears the flag and sends the user back through the flow without deleting anything | ● | `src/components/settings/onboarding-section.tsx` | none |
|  | Dashboard redesign | Move Instagram login and key entry into the dashboard with live validation, instead of a terminal prompt | ○ | no code yet | ENH-1 |

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

- **The masked `IG_PASSWORD` prompt saves an empty value on a real terminal** (`ONB-1`, blocker). The username saves, but the masked password read comes back empty, so `.env.local` gets `IG_PASSWORD=`. The Instagram sidecar then refuses to start ("IG_USERNAME and IG_PASSWORD must be set together", exit 78), launchd crash loops it, and Instagram sync never works. Nothing at onboarding time warns the buyer; the failure only shows up later as a dead sidecar. In the app, the connect step reports this as the local Instagram service isn't running.
- **The `ANTHROPIC_API_KEY` prompt echoes the key in plaintext** (`ONB-2`, medium). The same masked prompt code fails to suppress the echo on this terminal, so the key is visible on screen and lands in scrollback. It is entered and saved correctly; the defect is only that it is not hidden.

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

## 5. Interactions with other systems

Persistence. Each step persists independently, the niche in `app_settings`, the Instagram session in the sidecar, the channels as `channels` rows, the sync as a `sync_jobs` row, so step order in the UI carries no state of its own beyond `first_run_completed`.

The gate and the shell. The `(shell)` layout's route guard is the only thing that forces a fresh install into `/first-run`, and the failure strip it renders after first run reads the same sync record the first sync step produced. See [shared/navigation-and-shell.md](../../shared/navigation-and-shell.md).

Settings. Two panels carry related surfaces once onboarding is behind the user: the Instagram connection panel (the same login and disconnect surface the connect step uses, for re establishing a session later) and a read only local binaries check (yt-dlp, whisper-cli and its model). Settings' "Replay first run" clears `first_run_completed` to bring the flow back.

External services. The Instagram sidecar, owned by [ig-sync](../ig-sync/01-concept-brief.md), is the one service the flow drives directly, for login and the first sync. The Anthropic key is not entered in the app; it is set by `kai kit init` and consumed by analysis and the Vault pipeline later.

## 6. Edge cases

- A buyer who hits `ONB-1` finishes `kai kit init` successfully and reaches the dashboard, but the sidecar is dead, so the connect step (and every later sync) reports the service down. The onboarding flow itself gives no earlier sign that the password was lost.
- The connect step shows only the connected handle, never a follower or post count, because the app's Instagram status carries no such fields.
- Adding a handle while the sidecar cannot verify it does not reject the handle; it is tracked and checked on the first sync. Only a malformed handle is bounced.
- "Open Crowsnest" appears on any terminal sync status, including a failed one, because a cold first sync failing is expected and the app is usable regardless.
- Skipping is available on every step, so a user can reach the dashboard with no channel and no sync at all; the flow only guarantees the opportunity, not the outcome.
