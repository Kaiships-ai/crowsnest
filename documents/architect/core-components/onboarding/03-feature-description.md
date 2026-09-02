# onboarding: feature description

User-facing behavior of onboarding. Feeds the website, user guide, and MCP knowledge base.

Onboarding is what happens between a fresh install and a working feed. It has two halves:
a terminal setup step (`kai kit init`) that writes config and starts the app, and a
five-screen in-app flow at `/first-run` that a route guard forces a fresh install through
before any other page renders. This document describes the flow as shipped today; the
dashboard redesign (moving Instagram login and key entry into the dashboard with live
validation) is tracked as ENH-1 in [05-backlog-to-enhance.md](05-backlog-to-enhance.md) and
is not built.

## Set up crowsnest in the terminal (`kai kit init`)

### Summary

`kai kit init` is the one command a buyer runs after `kai login`. It writes `.env.local`,
asks for the Instagram account the sidecar will drive, generates the sidecar's shared
secret, optionally takes an Anthropic API key, asks where the vault lives, creates the
database, and starts the app — ending with the dashboard open in the browser. It refuses to
run without a cached license.

### The simple case

The buyer runs `kai kit init`. It prints that it created `.env.local`, then prompts in
order:

1. `IG_USERNAME` — the throwaway Instagram account the sidecar signs in as.
2. `IG_PASSWORD (not echoed)` — asked only if a username was given, typed without echo.
3. It generates `IG_SERVICE_TOKEN` automatically if the file still holds the placeholder.
4. `ANTHROPIC_API_KEY (blank to skip, not echoed)` — optional; the Create-Prompt export
   works without it, but AI analysis and the Vault pipeline need it.
5. `VAULT_PATH` — defaulting to `~/.crowsnest/vault`, whose directory is created.

It writes `.env.local` at mode `0600` (the file holds the Instagram password), runs the
database migrations and bootstrap, prints "Starting crowsnest…", and hands off to `kai up`,
which brings the dashboard up at `http://localhost:3000`.

### Known defects

Two defects in the secret prompts, both found in a real buyer-credential test
([evidence/10-onboarding-bugs.md](../../../../evidence/10-onboarding-bugs.md)) and both in
`ask(..., { secret: true })` in `src/cli/kai.ts`:

- **The `IG_PASSWORD` prompt saves an empty value on a real terminal (ONB-1, blocker).**
  The username saves, but the masked password read comes back empty, so `.env.local` gets
  `IG_PASSWORD=`. The Instagram sidecar then refuses to start ("IG_USERNAME and IG_PASSWORD
  must be set together", exit 78), launchd crash-loops it, and Instagram sync never works.
  Nothing at onboarding time warns the buyer; the failure only shows up later as a dead
  sidecar. In the app the connect step reports this as "The local Instagram service isn't
  running."
- **The `ANTHROPIC_API_KEY` prompt echoes the key in plaintext (ONB-2, medium).** The same
  masked-prompt code fails to suppress the echo on this terminal, so the key is visible on
  screen and lands in scrollback. It is entered and saved correctly; the defect is only that
  it is not hidden.

## Complete first run in the app (`/first-run`)

### Summary

The first-run flow is five screens served at `/first-run`, outside the normal app shell
(no sidebar, no topbar). A route guard sends any fresh install — setup not completed and no
channels tracked — here before it can see the shell, and keeps it here until first run is
finished. The screens are an unnumbered welcome plus four numbered steps: `01 FOCUS`,
`02 INSTAGRAM`, `03 CHANNELS`, `04 FIRST SYNC`. A persistent "Skip setup for now" in the
left aside jumps to the app at any point. The flow's whole job is to take an empty install
to at least one tracked channel with a first sync underway.

### The simple case

A fresh install opens the browser and lands on `/first-run` welcome. The user clicks Get
started, picks a focus on `01 FOCUS` and continues, connects their Instagram account on
`02 INSTAGRAM`, adds one or more channel handles on `03 CHANNELS`, and runs the first sync
on `04 FIRST SYNC`. When the sync reaches a terminal state they click "Open Crowsnest",
which marks first run done and drops them into the dashboard.

Each step saves through its own server action as it is passed, so the answers are already
persisted before the next screen appears. Reloading mid-flow re-lands on welcome but loses
nothing that was saved.

### The interaction, step by step

```
stateDiagram-v2
    [*] --> welcome : gate redirect (fresh install)
    [*] --> dashboard : gate pass (already set up, or firstRunCompleted)
    welcome --> focus : Get started
    focus --> connect : save niche, Continue
    connect --> sources : logged in (or Skip for now)
    sources --> sync : channels committed, Continue
    sync --> dashboard : terminal status, Open Crowsnest (sets first_run_completed)
    welcome --> dashboard : Skip setup for now (sets first_run_completed)
    focus --> dashboard : Skip setup for now
    connect --> dashboard : Skip setup for now
    sources --> dashboard : Skip setup for now
```

#### Arrive

The shell's route guard reads two facts — whether first run is completed and whether any
channel exists — and redirects a fresh install (`!firstRunCompleted && !hasChannels`) to
`/first-run`. A database that already has a channel, or that has the flag set, is treated as
done and never redirected, even if every channel is later removed. Navigating directly to
`/first-run` after finishing sends the user straight back to the dashboard rather than
re-running answered steps; the only supported way back is Settings' "Replay first run".

The left rail shows the four numbered steps. A step already passed is clickable to go back;
the current step is marked; anything ahead is locked until the step in front of it is done.

#### 01 FOCUS

The user picks a niche/focus. Continue saves it through `saveNicheSettingsAction` — the same
`niche_profile` setting the Settings page's Niche Profile section reads and writes — and
advances to connect.

#### 02 INSTAGRAM

The one real credential screen. It signs in through the local Instagram sidecar using the
credentials `kai kit init` wrote, and reads status through the same `getIgStatusAction` /
`igLoginAction` surface Settings uses. Clicking Connect Instagram authorises; Instagram may
respond with a two-factor prompt or a security challenge, and the screen handles both:

- **Two-factor:** a 6-digit code field. A wrong code stays on the same field, focused, with
  an inline error, rather than falling through to a generic error view.
- **Challenge:** the user picks email or SMS, then enters the verification code Instagram
  sends; a wrong code behaves the same way.

When connected, the screen shows the connected handle (`@username`) and nothing else — no
follower or post count, because the status the app has carries no such fields. If the
sidecar is unreachable it shows "The local Instagram service isn't running" with a re-check
control; if the service is up but has no credentials configured it asks for `IG_USERNAME`
and `IG_PASSWORD` to be set. "Skip for now" always advances regardless of connection state,
because the app stays usable disconnected and every sync control elsewhere renders its own
disconnected state.

#### 03 CHANNELS

A handle-in, handle-out list: the user types or pastes one or several Instagram handles,
adds them to a pending list, removes any they did not mean to, and Continue commits the whole
list through `addChannelAction` (idempotent per handle — re-pressing Continue after a partial
failure is safe). Nothing is a tracked channel until Continue is pressed. Whether the sidecar
can actually verify a typed handle against Instagram right now (it can only when logged in)
changes the helper copy under the input, not what Continue does; a handle that cannot be
verified is still added, to be checked on the first sync. Only a malformed handle is bounced.

#### 04 FIRST SYNC

The user runs the first sync over exactly the channels just added, through the same sync
progress panel the Channels page and Settings use — the seven-phase progress, the gap list,
and the retry affordances are identical, not a second copy. Instagram rate-limits a cold
session, so this first run is the one most likely to hit a snag, and the screen says so; the
failure surface is deliberately the real one. "Open Crowsnest" becomes available the moment
the run reaches any terminal status — success, partial, or failed — not only a clean success.
Pressing it sets `first_run_completed` and hands off to the shell, which reads the same sync
record and shows the failure strip itself if the run did not fully succeed.

#### Skip and finish

Both "Open Crowsnest" and "Skip setup for now" write `first_run_completed` through the
generic `updateAppSettingsAction` and then navigate to `/`. The flag write, not the link, is
what ends first run: on the zero-channel install this screen exists for, a plain link would
bounce straight back through the gate. Skipping loses nothing already answered — the niche,
the Instagram session, and any channels are each saved by their own step.

### Variants

| Variant | Set on arrival | Notes |
| --- | --- | --- |
| Fresh vs. seeded install | A fresh install (no flag, no channels) is redirected in; a database with any channel, or the flag set, is treated as done and never redirected. | The gate is compound on purpose so a real production database is never routed back into the wizard. |
| Instagram connected or not | The connect step reflects live sidecar status; the sources step's handle-verification copy follows whether a login exists. | "Skip for now" advances from connect either way; a handle added while disconnected is still tracked and checked on sync. |
| Sidecar reachable or down | Connect shows either the login surface or "The local Instagram service isn't running" with a re-check. | A buyer hitting ONB-1 (empty `IG_PASSWORD`) sees the service-down state here, because the sidecar crash-loops. |
| Anthropic key present or not | Set in the terminal by `kai kit init`; the flow does not ask for it. | Without the key, AI analysis and the Vault pipeline are unavailable later; the Create-Prompt export still works. |
| Return visit after finishing | `/first-run` redirects to the dashboard. | The only supported way to replay is Settings' "Replay first run", which clears the flag. |

### Cancel and interrupt

| Event | In the terminal half | In the in-app flow |
| --- | --- | --- |
| Abort partway | Ctrl-C stops `kai kit init`; whatever it had written to `.env.local` stays, and re-running edits the file in place. | Closing the tab records nothing beyond what each step already saved; a reload re-lands on welcome. |
| A backing service fails | A failed migration or bootstrap dies with a "rerun kai kit init" pointer; the app is not started. | A down sidecar shows the service-down state on connect; a failed first sync still reaches a terminal status and lets the user open the app. |
| The step's action fails | — | The failing step surfaces its own error (a wrong code inline on connect, a toast on skip) and does not advance; earlier saved answers are untouched. |
| Skip mid-flow | — | "Skip setup for now" writes `first_run_completed` and goes to the dashboard; the niche, session, and any channels already saved are kept. |

### Interactions with other systems

Persistence. Each step persists independently — the niche in `app_settings`, the Instagram
session in the sidecar, the channels as `channels` rows, the sync as a `sync_jobs` row — so
step order in the UI carries no state of its own beyond `first_run_completed`.

The gate and the shell. The `(shell)` layout's route guard is the only thing that forces a
fresh install here, and the failure strip it renders after first run reads the same sync
record the first-sync step produced. See
[shared/navigation-and-shell.md](../../shared/navigation-and-shell.md) and
[shared/status-and-failures.md](../../shared/status-and-failures.md).

Settings. Two panels carry related surfaces once onboarding is behind the user: the
Instagram connection panel (the same login/disconnect surface the connect step uses, for
re-establishing a session later) and a read-only local-binaries check (yt-dlp, whisper-cli
and its model). Settings' "Replay first run" clears `first_run_completed` to bring the flow
back.

External services. The Instagram sidecar is the one service the flow drives directly, for
login and the first sync. The Anthropic key is not entered here; it is set by `kai kit init`
and consumed by analysis and the Vault pipeline later.

### Edge cases

- A buyer who hits ONB-1 finishes `kai kit init` successfully and reaches the dashboard, but
  the sidecar is dead — so the connect step (and every later sync) reports the service down.
  The onboarding flow itself gives no earlier sign that the password was lost.
- The connect step shows only the connected handle, never a follower or post count, because
  the app's Instagram status carries no such fields.
- Adding a handle while the sidecar cannot verify it does not reject the handle; it is
  tracked and checked on the first sync. Only a malformed handle is bounced.
- "Open Crowsnest" appears on any terminal sync status, including a failed one, because a
  cold first sync failing is expected and the app is usable regardless.
- Skipping is available on every step, so a user can reach the dashboard with no channel and
  no sync at all; the flow only guarantees the opportunity, not the outcome.
