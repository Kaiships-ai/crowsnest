# onboarding: test cases

What proves onboarding works, end to end.

How to run these: onboarding spans a terminal half and an in-app half, so the setup differs
by section. For the terminal cases you need a machine with the Kit installed and a cached
license (`kai login` already run), on a real interactive terminal (a TTY) — the known bugs
only reproduce there, not under `kai kit init < answers`. For the in-app cases, start the
dev server and open `http://localhost:3001/first-run` (never `127.0.0.1`); to exercise the
gate you need to control two facts — `app_settings.first_run_completed` and whether any
`channels` row exists — and to reset between runs use Settings' "Replay first run", which
clears the flag. The connect step needs the Instagram sidecar reachable (or deliberately
down) and a set of real credentials that will accept, two-factor, or challenge on demand.

## kai kit init (terminal half)

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KITINIT-01 | P1 | no license | `kai kit init` refuses to run without a cached entitlement. | No `~/.kai/entitlement.json`. | 1. Run `kai kit init`. | It dies with "No license found. Run `kai login <license-key>` first." and writes nothing. | not run |
| KITINIT-02 | P1 | license, TTY | The happy path writes `.env.local`, generates `IG_SERVICE_TOKEN`, creates the db, and starts the app. | Licensed; on a TTY; give a username, password, key, and default vault. | 1. Run `kai kit init` and answer every prompt. | `.env.local` written at mode 0600, `IG_SERVICE_TOKEN` generated, migrations and bootstrap run, dashboard opens at `localhost:3000`. | not run |
| KITINIT-03 | P1 | license, TTY | (ONB-1, blocker) The masked `IG_PASSWORD` prompt saves an empty value on a real TTY, so the sidecar crash-loops. | Licensed; on a real interactive terminal. | 1. Run `kai kit init`.<br>2. Type a username, then a password at the `IG_PASSWORD (not echoed)` prompt.<br>3. Inspect `.env.local` and start the sidecar. | Record what happens: `.env.local` has `IG_PASSWORD=` (length 0) while `IG_USERNAME` is set; the sidecar refuses to start ("IG_USERNAME and IG_PASSWORD must be set together", exit 78) and launchd crash-loops it. (confirmed bug) | fail (confirmed): empty IG_PASSWORD written on real-credential test 2026-09-02 |
| KITINIT-04 | P1 | license, TTY | (ONB-2) The `ANTHROPIC_API_KEY` prompt echoes the key in plaintext on this TTY. | Licensed; on a real interactive terminal. | 1. Run `kai kit init` to the `ANTHROPIC_API_KEY (blank to skip, not echoed)` prompt.<br>2. Type a key and watch the screen. | Record what happens: the key is shown on screen as typed and lands in scrollback, despite the "not echoed" label. It is still saved correctly. (confirmed bug) | fail (confirmed): plaintext echo on real-credential test 2026-09-02 |
| KITINIT-05 | P2 | license | The `IG_PASSWORD` prompt is asked only when a username was given, and a blank vault path takes the default. | Licensed. | 1. Run `kai kit init`, leave `IG_USERNAME` blank, leave `VAULT_PATH` blank. | No password is asked; `VAULT_PATH` defaults to `~/.crowsnest/vault` and the directory is created. | not run |
| KITINIT-06 | P2 | license | Re-running edits an existing `.env.local` in place rather than overwriting it. | Licensed; a `.env.local` already present. | 1. Run `kai kit init` again. | It prints ".env.local already exists, editing it in place" and keeps surrounding keys and comments. | not run |

## The first-run gate

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GATE-01 | P1 | fresh db | A fresh install (flag unset, zero channels) is redirected to `/first-run` before the shell renders. | `first_run_completed` unset, no `channels` row. | 1. Navigate to `/` (or any shell page). | The shell never renders; the app lands on `/first-run` welcome. | not run |
| GATE-02 | P1 | seeded db | A database with a channel but the flag unset is NOT redirected. | At least one `channels` row, `first_run_completed` unset. | 1. Navigate to `/`. | The shell renders normally; no redirect to `/first-run`. | not run |
| GATE-03 | P1 | flag set | Once the flag is set the gate never redirects, even with every channel removed. | `first_run_completed` set, zero channels. | 1. Navigate to `/`. | The shell renders; no redirect. | not run |
| GATE-04 | P1 | flag set | Visiting `/first-run` after finishing sends the user straight back to the dashboard. | `first_run_completed` set. | 1. Navigate directly to `/first-run`. | Immediate redirect to `/`; the flow is not shown. | not run |
| GATE-05 | P2 | flag set | Settings' "Replay first run" clears the flag and lets the flow be seen again. | `first_run_completed` set. | 1. Open Settings, click "Replay first run" and confirm.<br>2. Navigate to `/`. | The flag is cleared; if no channel exists the next navigation redirects to `/first-run`. | not run |

## The first-run flow (/first-run)

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FLOW-01 | P1 | fresh db | The flow is five screens: welcome, then `01 FOCUS`, `02 INSTAGRAM`, `03 CHANNELS`, `04 FIRST SYNC`. | Fresh install at `/first-run`. | 1. Walk from welcome forward. | Welcome, then the four numbered steps in that order; the left rail numbers them 01–04. | not run |
| FLOW-02 | P1 | fresh db | The left rail lets a passed step be revisited, marks the current step, and locks steps ahead. | On `03 CHANNELS`. | 1. Click `01 FOCUS` in the rail.<br>2. Try to click `04 FIRST SYNC`. | `01 FOCUS` is reachable (goes back); `04 FIRST SYNC` is locked and does nothing. | not run |
| FLOW-03 | P1 | fresh db | Focus saves the niche through the same setting Settings' Niche Profile uses, then advances. | On `01 FOCUS`. | 1. Pick a focus and Continue.<br>2. Check Settings' Niche Profile after finishing. | The niche is saved and readable in Settings; the flow advances to connect. | not run |
| FLOW-04 | P1 | sidecar + creds | Connect signs in and, on success, shows the connected handle and only that. | Sidecar up, valid credentials that log in cleanly. | 1. On `02 INSTAGRAM` click Connect Instagram. | On success the screen shows CONNECTED and `@username`, with no follower or post count, and a "Choose channels" button. | not run |
| FLOW-05 | P1 | sidecar + 2FA | A wrong two-factor code stays on the same field, focused, with an inline error. | Credentials that trigger two-factor. | 1. Connect, reach the 6-digit code field.<br>2. Submit a wrong code. | The field stays, keeps focus, and shows an inline error; the flow does not fall through to a generic error view. | not run |
| FLOW-06 | P1 | sidecar + challenge | The challenge branch lets the user pick email or SMS, then enter the sent code. | Credentials that trigger a security challenge. | 1. Connect, choose Email or SMS.<br>2. Enter the code. | The choice is offered, the code is accepted, and the screen reaches CONNECTED. | not run |
| FLOW-07 | P1 | sidecar down | A down sidecar shows the service-down state with a re-check, and "Skip for now" still advances. | Sidecar not running (or ONB-1's empty `IG_PASSWORD`). | 1. Open `02 INSTAGRAM`. | "The local Instagram service isn't running" with a re-check control; Connect Instagram is not offered; "Skip for now" advances to sources. | not run |
| FLOW-08 | P2 | sidecar, no creds | With the service up but no credentials configured, connect asks for `IG_USERNAME` and `IG_PASSWORD` and disables Connect. | Sidecar up but no credentials configured. | 1. Open `02 INSTAGRAM`. | A message asking to set `IG_USERNAME` and `IG_PASSWORD`; the Connect button is disabled. | not run |
| FLOW-09 | P1 | fresh db | Channels are a handle-in, handle-out list; nothing is tracked until Continue, and `addChannelAction` is idempotent. | On `03 CHANNELS`. | 1. Add two handles, remove one, add it back.<br>2. Continue.<br>3. Re-run and add the same handle again. | Only the committed handles become `channels` rows on Continue; re-adding an existing handle does not duplicate it. | not run |
| FLOW-10 | P2 | disconnected | A handle added while the sidecar cannot verify it is still tracked; only a malformed handle is bounced. | On `03 CHANNELS`, not logged in. | 1. Add a well-formed handle and Continue.<br>2. Add a malformed handle. | The well-formed handle is tracked (checked on first sync); the malformed one is rejected before Continue. | not run |
| FLOW-11 | P1 | fresh db | The first sync runs over exactly the channels just added and reuses the shared sync progress panel. | On `04 FIRST SYNC` after adding channels. | 1. Click Run first sync. | The same seven-phase progress panel used elsewhere runs, scoped to the channels just added. | not run |
| FLOW-12 | P1 | fresh db | "Open Crowsnest" appears on any terminal status — success, partial, or failed — and sets `first_run_completed`. | A first sync driven to a terminal status (force a failure with the sidecar down if needed). | 1. Run the first sync to completion (or failure).<br>2. Click "Open Crowsnest". | The button appears on any terminal status; clicking it sets the flag and lands on the dashboard, where the failure strip reflects a non-clean run. | not run |
| FLOW-13 | P1 | fresh db | "Skip setup for now" sets the flag and goes to the dashboard, keeping whatever was already answered. | Mid-flow with a niche and/or channels already saved. | 1. Click "Skip setup for now". | `first_run_completed` is set, the app lands on the dashboard, and the niche and any channels are kept; a later gate check does not redirect back. | not run |
| FLOW-14 | P2 | fresh db | A reload mid-flow re-lands on welcome without losing saved answers. | On `03 CHANNELS` after saving a niche and committing channels. | 1. Reload the page. | The flow re-lands on welcome; the niche and channels are still saved server-side. | not run |

Not checkable by hand:

- Whether ONB-1 reproduces on every real TTY or only some terminal configurations — it is a
  TTY-specific echo/read interaction in `ask`.
- Whether a first sync that is navigated away from mid-run still commits its `sync_jobs`
  outcome that the shell's failure strip later reads.
- The exact set of Instagram responses (clean login vs. two-factor vs. challenge) a given
  account will produce, which depends on Instagram, not the app.
