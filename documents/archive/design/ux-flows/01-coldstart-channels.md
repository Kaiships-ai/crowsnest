# Cold start and channels

Ten UX flows for Crowsnest, split into two groups. Group A is cold start: the first
launch of an empty app, connecting the Instagram burner account, connecting the owned
channel (kaiships.ai), and the local binaries check. Group B is channels: adding one,
the first deep sync, batch syncing the stalest channels, failure and recovery, the
channel detail page, and fleets.

Scope notes that apply to every flow below. Single user, local, no auth, no multi
tenancy. Instagram only in v1. The UI is the primary interface, desktop first, dark
only. The burner account credentials (read by the Python sidecar) and the owned channel
Graph token are separate identities and must never cross: instagrapi never touches the
owned account.

Two of these flows describe behaviour that does not exist in this codebase yet. A3 (Graph
API token for the owned channel) has no implementation anywhere in `src` or `services`,
though a working Graph client for kaiships.ai already exists in the separate
Kai-Official-OS project and is not to be rebuilt. B3 (batch sync of the 3 to 5 stalest
channels) has no implementation either: `runSync()` with no `channelIds` walks every
Instagram channel in one run, and there is no scheduler at all. Both are written as
proposals and marked as such, so the annotation pass can separate "this is wrong" from
"this was never built".

Where a flow describes something already shipped, the real component, function, table
column or error code is named. Where it describes something proposed, the block says so
in its first line.

Current real state at the time of writing: 2 channels (@kallaway with 8 videos and 8
thumbnails, @hormozi with zero videos and never synced), and an empty `sync_jobs` table.

---

## Group A, cold start

### A1. First run, empty app, nothing configured

**Entry.** Kai runs `npm run dev`, opens `http://localhost:3001/`, and lands on the
Dashboard route. This is the only entry: there is no onboarding wizard, no welcome
modal, no route guard that redirects an unconfigured app to Settings.

Note on the origin: browse via `localhost:3001`, not `127.0.0.1`. Next 16 silently
blocks Server Actions from a mismatched origin, and every action on this page is a
Server Action.

**Screen.** Top to bottom.

1. `Sidebar` on the left (`src/components/layout/sidebar.tsx`). Nav items from
   `nav-items.ts`, plus a sync status block at the bottom. With no sync ever run, the
   dot is `never` grey (`bg-muted-foreground`) and `railLabel` reads "Never synced".
2. `Topbar` renders the route h1. On `/` that is "Dashboard".
3. Page content. `src/app/(shell)/page.tsx` checks `stats.channelsTracked === 0` first.
   With a truly empty database it renders one centred true-empty state: a line of muted
   text saying no channels are tracked yet, and a primary button "Add your first
   channel" linking to `/channels`. None of the four KPI tiles, the outlier row, the
   fleet spike row or the recently viewed row render in this state. That is deliberate:
   four separate zero states stacked on each other read as a broken app.

With the current real database (2 channels) this empty branch does not fire, so the
first run Kai actually sees is the populated Dashboard with mostly-zero KPIs. Worth
deciding whether that is the state to design for.

**Actions.**

- "Add your first channel": navigates to `/channels`. Continues into B1.
- Sidebar nav: Dashboard, Feed, Channels, Vault, Settings. All reachable, all render
  their own empty states.
- Sidebar sync block: clicking it opens the `SyncProgressPanel` in a dialog. With no
  `sync_jobs` row the panel shows "No sync has run yet" and the detail line "Nothing in
  sync_jobs to report."
- Command menu (`command-menu.tsx`) is mounted in the shell layout.

**System.** `DashboardPage` is `export const dynamic = "force-dynamic"`, so it reads the
live SQLite database on every visit rather than being frozen at build time. It calls
`getDashboardStats`, `getTopOutliersToday`, `getFleetSpikes`, `getRecentlyViewed` in
parallel against `src/server/queries/dashboard.ts`. Nothing on this page touches
Instagram, the sidecar, or any network. The database file is `CROWSNEST_DB_PATH`,
default `data/crowsnest.db`.

The app refuses to start at all if `.env.local` is malformed: `src/server/config.ts`
validates every variable at boot. `IG_SERVICE_TOKEN` is the only strictly required one.
A bad `LOOKBACK_DAYS` (outside 1 to 3650) or `MAX_ITEMS_PER_SYNC` (outside 1 to 10000)
stops the process rather than surfacing later as an empty sync.

**Failure.**

- No `.env.local` at all, or `IG_SERVICE_TOKEN` missing: the dev server does not start.
  Kai sees a config error in the terminal, not in the browser. There is no in-app screen
  for this, and there cannot be, because the app is not running.
- Database file missing or unmigrated: the queries throw and the route errors. Unknown
  what the current error boundary renders here. Open question below.
- Browsing via `127.0.0.1:3001` instead of `localhost:3001`: pages render, but every
  Server Action is silently blocked by Next 16. Symptom is buttons that appear to do
  nothing. There is no in-app warning for this today.

**Empty.** This flow is the empty state. The whole screen is the "add your first
channel" call to action.

**Open question.** Should first run route Kai to Settings instead of the Dashboard?
Right now nothing tells him the Instagram sidecar is not running until he opens
Settings or starts a sync and it fails with `IG_SERVICE_DOWN`. A first-run checklist
(sidecar up, account connected, one channel added) does not exist. Second open question:
what should the app show when the database is missing or unmigrated, since that is the
most likely genuine first-run failure and there is no designed screen for it.

---

### A2. Connect the Instagram burner account

**Entry.** Settings route, `/settings`. The Instagram connection panel is the second
section on the page, below the niche profile section. Kai gets here from the sidebar,
or from a failure elsewhere that told him to go to Settings (every `IG_AUTH_REQUIRED`,
`IG_TWO_FACTOR` and `IG_CHALLENGE` message points here).

**Screen.** The panel is `src/components/settings/instagram-section.tsx`. Top to bottom:

1. Section heading "Instagram connection", a one-line description saying sync talks to a
   local Python instagrapi sidecar that holds the authenticated session, and a "Re-check"
   button on the right with a refresh icon.
2. A bordered card whose contents depend on which of eight view states is active.
3. A permanently visible amber risk callout at the bottom with a shield icon. It states
   that this uses Instagram's private API, that it violates Meta's Terms of Service, that
   the connected account can be challenged, restricted or permanently banned with no
   appeal path, and that Kai should use a burner he can afford to lose. This callout does
   not disappear once connected.

The eight view states, computed by `viewStateOf(phase, statusResult, failure)`:

- `service_down`: red row, "Instagram service isn't running", the failing detail, the
  configured `IG_SERVICE_URL`, and a code block with `npm run ig:service`. Reached when
  the status read fails with `IG_SERVICE_DOWN`, or when a flow step failed with it.
- `no_credentials`: amber row, "No Instagram credentials configured", detail "service is
  running". Body text says to set `IG_USERNAME` and `IG_PASSWORD` in `.env.local` and
  restart the sidecar, and states that these are read by the sidecar process only, that
  the app never receives them, never renders them, and that no form on this page submits
  a password.
- `logged_out`: amber row, "Not connected", detail "credentials configured, no active
  session". Body explains that Connect signs in with the credentials already in the
  sidecar's environment and that Instagram may answer with a two-factor prompt or a
  security challenge. One "Connect" button.
- `connecting`: spinner row, "Connecting...", detail "signing in via the sidecar". Body
  warns this can take up to two minutes because Instagram logins are rate-limited and the
  sidecar adds jitter. No buttons. Re-check is disabled while in this phase.
- `two_factor_required`: amber row "Two-factor code required", then a `CodeForm`: label
  "6-digit code", numeric input with `autoComplete="one-time-code"`, `maxLength` 8,
  placeholder 123456, monospace, Submit and Cancel buttons. Enter submits. Hint says the
  code comes from the authenticator app or the SMS Instagram just sent.
- `challenge_required`, step 1 of 2: amber row "Instagram issued a security challenge",
  detail "step 1 of 2", body "Choose where Instagram should send the verification code",
  and three buttons: Email (primary), SMS (outline), Cancel (ghost).
- `challenge_required`, step 2 of 2: same row with detail "step 2 of 2", then a
  `CodeForm` labelled "Verification code" with a hint naming the channel just picked.
- `connected`: green row reading "Connected as @handle" (or just "Connected" if the
  sidecar did not report a username), then a definition list: instagrapi version (or
  "not reported by the service"), session file badge reading either "loaded from disk" or
  "not loaded (fresh login this run)", the service URL, and, only when present, a
  "Rate-limit cooldown" row showing `cooldownUntil`. One "Disconnect" button.
- `error`: red row with the error message as the label and the error code as the detail.
  Below it, one of three sentences depending on the error's flags: retryable means worth
  retrying because it is a transient network, service or rate-limit condition;
  `needsUserAction` means retrying as-is will not help and something must change first;
  otherwise it says retrying is unlikely to help and to check the sidecar logs. Buttons:
  "Re-check status" always, plus "Retry connect" only when the error is retryable.

**Actions.**

- Re-check: calls `getIgStatusAction()`, clears the local failure, resets `phase` to
  idle, and re-renders from whatever the sidecar actually reported.
- Connect: sets phase `connecting`, calls `igLoginAction()`. The result routes to
  `two_factor`, `challenge_choice`, `error`, or idle-plus-status-refresh on success.
- Email / SMS: `igChallengeChooseAction("email" | "sms")`. If the sidecar answers
  `challenge_required` again, the panel moves to step 2 (code entry). Any other status
  means the challenge resolved without a code.
- Submit (2FA): `igTwoFactorAction(code)`.
- Submit (challenge): `igChallengeCodeAction(code)`.
- Cancel (on either code form): runs the same path as Re-check. It does not tell the
  sidecar to abandon the challenge, it just returns the panel to the real server status.
- Disconnect: `igLogoutAction()`, then a status refresh.

**System.** All six actions live in `src/server/actions/ig-actions.ts` and are thin
wrappers over HTTP calls to the Python sidecar at `IG_SERVICE_URL`, default
`http://127.0.0.1:8765`, authenticated with the shared `IG_SERVICE_TOKEN`. The initial
status is fetched server-side by `SettingsPage` and passed in as `initialStatus`, so the
panel renders its real state on first paint with no mount effect.

The status shape is `{ loggedIn, credentialsConfigured, username, instagrapiVersion,
sessionLoaded, cooldownUntil }`, mapped in `getIgStatusAction` from the sidecar's
`/health` response (`health.canLogin` becomes `credentialsConfigured`).

The design rule the component states explicitly: `phase` is what the user just started,
`statusResult` is what is actually true server-side, and the two are never collapsed.
After every step that could have changed the session, `/health` is re-read and the panel
re-renders from that. Nothing is inferred optimistically from a button click.

Credentials never reach this process. `IG_USERNAME` and `IG_PASSWORD` are read by the
sidecar only. The session blob is persisted at `IG_SESSION_PATH` (default
`data/ig-session.json`) with mode 0600, so a restart does not force a re-login.
Re-login storms are what get accounts flagged. `IG_DEVICE_SEED` pins the device
fingerprint so the session looks like the same phone across restarts; it defaults to a
deterministic hash of the username.

**Failure.** Real codes from `src/server/ig/errors.ts`:

- `IG_SERVICE_DOWN`: routed to the `service_down` view even when it happened mid-flow,
  because the fix is to start a process, not to click Connect again. Marked retryable.
- `IG_SERVICE_UNAUTHORIZED`: the sidecar rejected the shared secret. This is a config
  fault on our side, not an Instagram problem, and the error text says to check
  `IG_SERVICE_TOKEN` in `.env.local`. Not retryable, not `needsUserAction`, so the panel
  shows only "Re-check status".
- `IG_BAD_CREDENTIALS`: Instagram rejected the saved credentials. `needsUserAction`, so
  no Retry button.
- `IG_TWO_FACTOR` and `IG_CHALLENGE`: normally these become the two-factor and challenge
  views rather than errors. If they arrive as a raw error, they are `needsUserAction`.
- `IG_RATE_LIMITED`: retryable, so Retry connect appears. The sidecar has already
  persisted a cooldown deadline (see A2 system note and B4), so retrying before it
  elapses will simply fail again with the same code.
- `IG_PROXY_BLOCKED`: `IG_PROXY` is set and Instagram is blocking it. `needsUserAction`.
- `IG_NETWORK`: retryable.
- `IG_UNKNOWN`: anything that did not match the sidecar's error envelope contract. The
  panel shows the raw message with the code `IG_UNKNOWN`.

Failure cases the panel does not currently distinguish: a wrong code typed into either
code form comes back as whatever the sidecar returns, and there is no dedicated "that
code was wrong, try again" state that keeps the form on screen with the field cleared.
Unknown what the sidecar returns in that case.

**Empty.** With no `IG_USERNAME` and `IG_PASSWORD` set and the sidecar running, the
panel sits in `no_credentials` with no buttons at all. That is the true empty state: the
only way forward is editing `.env.local` and restarting the sidecar. With the sidecar
not running, `service_down` wins and the panel shows the start command instead.

**Open question.** Three. First, there is no in-app way to enter credentials, by design,
so the first-run path requires a terminal and a file edit. Is that acceptable for v1, or
should the panel at least detect that `.env.local` exists and offer to open it? Second,
Cancel on a challenge form abandons the UI flow but says nothing about the sidecar's own
challenge state, so it is unknown whether a cancelled challenge can be resumed or must
be restarted from Connect. Third, there is no visible countdown when `cooldownUntil` is
set: the panel prints the timestamp, not the remaining time, and offers no explanation
of what it means for sync.

---

### A3. Connect the owned channel (kaiships.ai) via a Graph API token

**This flow is not implemented in Crowsnest,** but the client already exists elsewhere.
There is no Graph API code path anywhere in `src` or `services`, and `.env.example` has
no Graph variables. A working Instagram Graph API client for kaiships.ai lives outside
this repo, in the Kai-Official-OS project:

- Command: `Kai-Official-OS/.claude/commands/ksa/measure.md`, invoked as `/ksa:measure`.
- Client: `Kai-Official-OS/.claude/commands/ksa/serve/ig_stats.py`.
- Credentials: `Kai-Official-OS/.secrets/instagram.env`, holding `IG_ID`,
  `IG_LONG_LIVED_TOKEN`, `IG_APP_ID`, `IG_APP_SECRET`.
- It uses the Instagram Login flow, so no Facebook Page link is needed. The token is long
  lived with a 60 day expiry, refreshed by `ig_publish.py refresh`.
- Metrics it requests: `reach`, `saved`, `shares`, `total_interactions`, `comments`,
  `likes`, plus `views` for reels. It also classifies comments as organic, self test, or
  bot.

That client is not to be rebuilt. Kai's decision is that Crowsnest gets a copied token in
its own `.env.local` rather than reading the other project's file, so the two projects
stay independent and the copy is allowed to go stale on its own. Everything below is a
proposal for how Crowsnest surfaces that copied token, not a description of current
Crowsnest behaviour.

Why this cannot replace the burner path: the Graph API cannot enumerate an arbitrary
creator's media, and `docs/research/DATA.md` records that `business_discovery` exposes
followers, bio, media count and recent media for other accounts but not `view_count` or
`play_count`, which are owner-account-only. So the Graph API covers exactly one account,
the one Kai owns, and instagrapi still has to cover everyone else. That split is the
whole reason the two identities exist.

**Entry.** Proposed: a new "Your channel" section on `/settings`, placed between the
Instagram connection panel and the API keys section. It sits after the burner panel on
purpose: the two are visually adjacent and the ordering makes the separation legible.

**Screen.** Proposed, top to bottom:

1. Heading "Your channel", with a one-line description saying this is the account Kai
   owns, read through Instagram's official Graph API, and that it is a separate identity
   from the burner above.
2. A bordered card with a status row in the same `StatusRow` idiom the Instagram panel
   uses (green check, amber warning, red circle):
   - No token: amber, "No Graph token configured", with body text naming the four
     variables to copy into `.env.local` (`IG_ID`, `IG_LONG_LIVED_TOKEN`, `IG_APP_ID`,
     `IG_APP_SECRET`) and where to copy them from
     (`Kai-Official-OS/.secrets/instagram.env`), and stating that the app reads them but
     never writes them.
   - Token present but unverified: amber, "Token set, not yet verified", with a "Verify"
     button.
   - Verified: green, "Connected as @kaiships.ai", with a definition list showing the
     `IG_ID`, the token expiry date, and the last successful call.
   - Token expiring soon: amber, naming the days remaining. The token is long lived with
     a 60 day expiry, and the refresh lives in the other project
     (`ig_publish.py refresh`), so Crowsnest's job here is to warn early and say where to
     go, not to refresh.
   - Token expired or rejected: red, with the Graph API error and a line saying to run
     the refresh in Kai-Official-OS and re-copy the value.
3. A separation callout, styled like the risk callout but neutral rather than amber:
   states that the burner session and this token are never used for the same request,
   that instagrapi never touches this account, and that the Graph client never touches
   any other account.

**Actions.** Proposed:

- Verify: calls a new `verifyGraphTokenAction()` that makes one call against `IG_ID`
  asking for `username` and `followers_count`, and reports the result. Presence-only
  checking is not enough here, because an expired long-lived token looks identical to a
  valid one in `.env.local`. This is the same shape as the existing `ApiKeyStatusCard`
  with its `onTest` prop, which the Anthropic key already uses.
- Copy the required variable names to the clipboard, so the file edit is a paste rather
  than a retype.
- No disconnect button. Removing the token means deleting it from `.env.local`, the same
  as every other key on this page.
- No refresh button. The refresh lives in Kai-Official-OS by decision, and a refresh
  button here would imply Crowsnest owns the token lifecycle when it owns a copy.

**System.** Proposed. A new `src/server/graph/` module, deliberately parallel to
`src/server/ig/` and sharing nothing with it: its own client, its own typed error set,
its own config block. Behaviour is ported from `ig_stats.py` rather than redesigned. The
hard rule to encode in code, not just in prose: no function in `src/server/ig/` may
accept a Graph token, and no function in `src/server/graph/` may read `IG_USERNAME`,
`IG_PASSWORD` or `IG_SESSION_PATH`.

One naming hazard worth flagging now. `IG_APP_ID` and `IG_APP_SECRET` sit in the same
`IG_` namespace as `IG_USERNAME`, `IG_PASSWORD`, `IG_SERVICE_TOKEN` and `IG_SESSION_PATH`,
which all belong to the burner sidecar. Two identities that must never cross should not
share a variable prefix in one `.env.local`. Renaming the copies (for example
`GRAPH_IG_ID`, `GRAPH_LONG_LIVED_TOKEN`) costs nothing now and prevents a wiring mistake
later.

The metrics the existing client requests (`reach`, `saved`, `shares`,
`total_interactions`, `comments`, `likes`, and `views` for reels) do not line up with
what Crowsnest's `videos` table stores for tracked creators (`viewCount`, `likeCount`,
`commentCount`). So the owned channel would carry columns nothing else has, and would be
missing nothing important, but any side-by-side comparison view has to pick a common
subset.

Where the owned channel's data lands is the real design question. Two options:

- Same `channels` table with a new column marking it as owner-owned and Graph-sourced.
  Then the whole app (Feed, outlier scoring, fleets, channel detail) works on it for
  free, but `runSync()` must learn to route by source, and the current
  `where(eq(channels.platform, "instagram"))` library sweep would pick it up and hand it
  to instagrapi, which is exactly the crossing that must never happen.
- A separate table, so no existing code path can reach it accidentally. Safer, but then
  every screen that wants to compare Kai's own numbers against the outliers he tracks
  needs new plumbing.

**Failure.** Proposed error taxonomy, deliberately not reusing the `IG_*` codes, so a
Graph failure can never be mistaken for a burner failure in a log or a gap row: token
missing, token expired (the likely one, given the 60 day lifetime and a copy that can go
stale independently), token rejected, wrong `IG_ID`, rate limited (the Graph limit is 200
calls per user per hour), and network.

The failure this design is most exposed to is the stale copy. Kai refreshes the token in
Kai-Official-OS, Crowsnest keeps the old value, and the panel goes red 60 days after the
copy rather than 60 days after the refresh. The panel should therefore show days
remaining rather than only a pass or fail, so the drift is visible before it bites.

**Empty.** No token configured. The panel shows the four variable names and where to copy
them from, and nothing else. No Verify button, because there is nothing to verify.

**Open question.** Is A3 in v1 at all? The client already exists and works, so the cost
here is only the copy-and-surface work, not the Meta approval work, which changes the
calculation considerably from what `docs/research/DATA.md` assumed. If it is in, three
things need Kai's call. The storage decision above (same `channels` table with a source
marker versus a separate table), because it determines whether the owned channel shows up
in the Feed and in outlier scoring or lives in its own corner. Whether to rename the
copied variables out of the `IG_` prefix. And what Kai actually wants from his own channel
here: a baseline to compare tracked creators against, or just a place to read his own
numbers without switching projects.

---

### A4. Local binaries check

**Entry.** Settings route, the "Local binaries" section, fourth on the page (after the
niche profile, the Instagram connection, and API keys). Kai also arrives here from a
transcription failure, because `whisperAvailability()` writes its reason text to point
back at this section.

**Screen.** `src/components/settings/local-binaries-section.tsx`, a plain server
component with no interactivity. Top to bottom:

1. Heading "Local binaries" and the subtitle "Optional, enables keyless local
   transcription and manual reel import."
2. One bordered row per binary. Green check icon (`#34D399`) when available, amber
   warning icon (`#E8B23D`) when not. Row content is the label, then the reason string in
   small muted text when unavailable.
3. A footer line with the install command: `brew install yt-dlp whisper-cpp`.

There are exactly two rows today, built in `src/app/(shell)/settings/page.tsx`:

- "yt-dlp", available when `detectBinary(process.env.YTDLP_BIN_PATH ?? "yt-dlp")`
  resolves. Reason when missing: "not found on PATH".
- "whisper-cli (+ model)", available only when both the binary and the model file exist.

The scenario in scope, whisper-cli present but the GGML model missing, renders as an
amber row with the reason: whisper model not found at the resolved path, plus a note
that `brew install` does not fetch it and it must be downloaded separately. The default
path is `~/.cache/whisper/ggml-large-v3-turbo.bin`, overridable with `WHISPER_MODEL_PATH`.
The binary path is overridable with `WHISPER_CPP_BIN_PATH`.

**ffmpeg is not checked.** It appears only in a code comment in `src/server/lib/exec.ts`
listing what `execFileP` is used for. There is no ffmpeg row, no detection call, and no
error message that names it. If any part of the transcription or media path actually
shells out to ffmpeg, its absence today fails somewhere else with a raw exec error.

**Actions.** None. The section is entirely read-only, and it says so by construction: no
`"use client"` directive, no buttons, no refresh. The only way to re-run the check is to
reload `/settings`, which works because the route is `force-dynamic` and re-runs
`detectBinary` and `whisperAvailability` on every load.

**System.** `detectBinary(bin)` in `src/server/lib/exec.ts` shells out to
`/bin/sh -c 'command -v "$1"' _ bin`, passing the name as a positional argument so the
shell cannot reinterpret it, and returns the absolute path or null. It never throws.

`whisperAvailability(env)` in `src/server/transcribe/whispercpp.ts` runs two checks in
order and returns the first failure: `detectBinary` on the whisper binary, then
`existsSync` on the model path. Both failure reasons are written as instructions, and
both point at this Settings section as the place to fix it. A comment in that file notes
that `scripts/setup-local.sh` was planned and never created, so this section is the only
real repair path.

Downstream consumers: `downloadToTmp()` needs yt-dlp and throws a plain Error naming the
brew install command when it is missing. `WhisperCppProvider` runs
`whisper-cli -m <model> -f <file> --output-json --output-file <base> -nt` with a 300
second timeout and parses the JSON sidecar file.

**Failure.**

- Neither binary present: two amber rows, both actionable, and the footer install command
  covers both.
- whisper-cli present, model missing: one amber row naming the exact path that was
  checked. This is the common case, because `brew install whisper-cpp` does not fetch a
  model.
- `WHISPER_MODEL_PATH` set to a path that does not exist: same row, and the reason names
  the configured path rather than the default, so a typo is visible.
- `detectBinary` itself failing (no `/bin/sh`, exec blocked): caught and returned as
  null, so it renders identically to "not installed". A sandboxed environment would
  therefore show a misleading amber row. Not currently distinguished.
- A binary present but broken (wrong architecture, missing dylib): reports as available,
  because detection is a PATH lookup and never runs the binary. The failure then surfaces
  at transcription time as a raw exec error.

**Empty.** The section always renders both rows, so there is no empty state. With
everything installed it is two green rows and the install hint, which is arguably noise.

**Open question.** Should ffmpeg be added as a third row, and is it actually required by
any current code path or only by a planned one? Second: should this section detect a
whisper model at a non-default location and offer to set `WHISPER_MODEL_PATH`, or is a
`.env.local` edit the intended repair for everything on this page? Third: green rows for
optional tooling that is already working may not be worth the vertical space, so this
section could collapse to problems only once everything is green.

---

## Group B, channels

### B1. Add a channel by handle or profile URL

**Entry.** `/channels`. The "+ Channel" button sits above the table, right-aligned. Kai
also arrives from the Dashboard's true-empty state via "Add your first channel", which
links to `/channels` (not directly into the dialog).

**Screen.** `AddChannelDialog` in `src/components/channels/add-channel-dialog.tsx`. A
modal dialog:

1. Title "Add a channel", description "Track a channel by handle, or import a single reel
   by URL."
2. Two tabs: "By handle" and "Paste reel URL".
3. By handle tab: label "Instagram handle", input with placeholder
   `@handle or instagram.com/handle`, a hint saying a profile URL works too and is
   normalised to a handle, and a "Track channel" button disabled until the field is
   non-empty.
4. Paste reel URL tab: label "Reel URL", input with placeholder `https://...`, and an
   "Import reel" button, disabled until non-empty.
5. A destructive `Alert` below the tabs when the last submit failed, showing the raw
   error string. Switching tabs clears it. Closing the dialog resets everything.

There is no platform picker. It used to offer TikTok and YouTube Shorts and was removed,
because nothing could ever sync them and choosing one produced a channel row that
silently never updated. The `platform` column stays in the schema for a future second
source.

**Actions.**

- Track channel: `bridgeAddChannel(handle)` in `sync-bridge.ts`, which calls
  `addChannelAction(handle)`. On success it fires a toast reading `<handle> tracked` and
  closes the dialog. On failure it renders the error inline and keeps the dialog open.
- Import reel: `bridgeImportReel(url)`, toast "Reel imported" on success.
- Tab switch: clears the error, keeps both field values.
- Close: resets handle, URL, error and pending state.

Note what is missing: adding a channel does not start a sync. The dialog closes, the
table refreshes (or does not, see the failure notes), and the channel sits at "Never"
until Kai syncs it. There is no "track and sync now" affordance.

**System.** `addChannel({ handle })` in `src/server/services/sync-engine.ts`:

1. `normalizeHandle(input)`: trims, extracts the handle out of an `instagram.com/<handle>`
   URL with a regex, strips a leading `@`, strips trailing slashes, then validates against
   `/^[A-Za-z0-9._]{1,30}$/` and throws on anything else. It returns the handle with a
   leading `@`. This exists because the old normalizer accepted a pasted profile URL and
   created a row literally named `@https://www.instagram.com/hormozi/`.
2. Dedupe: selects from `channels` on `(platform = instagram, handle)`. An existing
   channel returns its id and writes nothing, so adding a duplicate is a silent no-op that
   still reports success.
3. Profile fetch: `client.profile(handle)` against the sidecar. Best-effort. A failure is
   caught, logged as `channel.add.profile_failed`, and recorded rather than aborting.
4. Avatar: if the profile came back with an avatar URL, `tryEnsureAsset(url, "avatar")`
   downloads it into `MEDIA_ROOT` and returns a `media_assets` id.
5. Insert into `channels` with: id, platform instagram, handle, `externalId`,
   `displayName`, `avatarAssetId`, `followerCount`, `followingCount`, `mediaCount`, `bio`,
   `isVerified`, `isPrivate`, `syncError` and `syncErrorCode` (set only if the profile
   fetch failed), `trackedSince` = now, and `lastSyncedAt` = now only when a profile was
   actually fetched.

So a profile fetch failure produces a thin row: handle and nothing else, with the error
recorded on the row. `sync-bridge.ts` documents why that still reports `ok: true`: a
channel really was tracked, and the failure surfaces on the row's own warning icon in the
table rather than through this dialog's toast. An invalid handle, by contrast, throws in
`normalizeHandle` and lands in the `ok: false` branch.

`importReelByUrl(url)` is a separate path and deliberately not part of sync: it shells out
to yt-dlp (`src/server/providers/ytdlp.ts`), creates a thin channel stub if the reel's
owner is not tracked, downloads the thumbnail into our own storage, upserts one row into
`videos`, and recomputes that channel's outlier scores.

**Failure.**

- Invalid handle (anything not matching the character class, including an empty result
  after normalising): inline alert reading `Invalid Instagram handle: "<input>"`. The
  dialog stays open with the value intact.
- `IG_NOT_FOUND`: the profile fetch fails, but the channel is still created as a thin row
  and the dialog reports success. Kai finds out only from the warning icon on the table
  row, whose tooltip reads that the account no longer exists on Instagram. This is a real
  rough edge: a typo'd handle produces a tracked channel and a success toast.
- `IG_PRIVATE`: same shape. Thin row, success toast, warning icon on the row saying the
  account is private so its posts cannot be read.
- `IG_SERVICE_DOWN`: same shape again. Thin row with `syncErrorCode = IG_SERVICE_DOWN`. A
  later sync will fill it in once the sidecar is up.
- `IG_RATE_LIMITED`: thin row, and the cooldown is now account-wide, so the next few
  operations will fail too.
- Reel import with yt-dlp missing: throws with a message naming `brew install yt-dlp`,
  rendered in the inline alert.
- Reel import of a URL yt-dlp cannot resolve: whatever yt-dlp's error text is, shown raw.

**Empty.** `/channels` with no channels renders `ChannelTable`'s empty branch: a centred
muted line reading "No channels in this fleet yet." with 16 units of vertical padding.
The wording is fleet-specific even when no fleet filter is applied, which is wrong for
the all-channels case.

**Open question.** Four. Should a successful add immediately kick off that channel's first
sync, since a tracked channel with no videos is useless until it syncs? Should a profile
fetch failure block the add instead of creating a thin row, at least for `IG_NOT_FOUND`,
where the handle is almost certainly a typo? Does the table refresh after an add, or does
Kai have to reload, since the dialog calls no `router.refresh()` (unlike the fleet
dialogs, which do)? And should the empty-table copy differ between "no channels at all"
and "no channels in this fleet"?

---

### B2. First sync of a new channel, deep 90 day reach

**Entry.** Three places start a single-channel sync:

- The channel detail page header, "Sync now" (`ChannelHeader`).
- The channels table row dropdown, "Sync now" (`ChannelTable`).
- The `SyncProgressPanel`'s per-gap "Retry" button, which is the same call with one
  channel id.

**Important gap against the settled decision.** The deep first sync does not exist.
`runSync()` uses `opts.lookbackDays ?? config.LOOKBACK_DAYS`, and `LOOKBACK_DAYS`
defaults to 30 for every run. Nothing anywhere checks whether a channel has synced
before. The 90-day-first / 30-day-after rule is a design decision that has not been
implemented, and Kai deferred the final call on it. Everything below describes the real
mechanism and marks where the 90-day branch would go.

**Screen.** On the channel detail page, `ChannelHeader` while a run covering this channel
is live:

1. Avatar (40px), handle as an h2, a platform pill, follower count, and an external link
   icon opening `https://www.instagram.com/<handle>/` in a new tab.
2. Right side: a live readout line, then the Sync now button, then a cancel X, then a
   disabled Untrack button.
3. The live readout is worded off `coverage`, which comes from the `sync_jobs.channel_id`
   column, not from guessing at the handle. When `coverage === "library"` it reads
   `Library sync running` plus either the handle currently being worked on or the phase
   label. When `coverage === "channel"` it reads the phase label plus the posts-seen
   count, for example `Fetching posts, 47 posts seen`.
4. Sync now shows "Syncing..." with a spinning icon while busy, and is disabled.
5. The cancel X appears only when `coverage === "channel"`, so a library-wide run cannot
   be cancelled from a single channel's header. It is disabled once `cancelRequested` is
   true.

Phase labels come from `phaseLabel()` in `sync-progress-view.ts` and map the seven
`sync_jobs.phase` values: starting is "Starting up", profile is "Reading the profile",
fetching is "Fetching posts", saving is "Saving posts and thumbnails", retrying is
"Backing off after an upstream error", scoring is "Scoring outliers", finalizing is
"Finishing up". A null phase reads "Working" rather than guessing.

In the sidebar rail at the same time: an amber dot, `railLabel` reading
`Syncing @<handle>`, and `railDetail` reading `Channel N of M` plus the handle. Clicking
opens the full `SyncProgressPanel` in a dialog.

The full panel (also embedded in Settings) shows, top to bottom:

1. A coloured dot and the headline from `statusHeadline()`, with the detail sentence from
   `statusDetail()` below it.
2. Cancel button while running, Retry buttons when there are gaps.
3. A determinate progress bar on `channelsDone / channelsTotal` and nothing else. Before
   the run has enumerated its channel list the bar is indeterminate with the label
   "resolving channels" and a note saying there is no fraction to draw yet.
4. A meta line: running for or took `M:SS`, plus the retry count when non-zero, plus the
   lookback in days when the row has one.
5. A posts-seen line rendered as `<seen> / <maxItems> (cap)` with a note explaining that
   Instagram never says how many posts there are, so the per-sync cap is the only
   denominator. There is deliberately no percentage here.
6. Six counters: created, updated, failed, deleted, assets saved, assets failed. Failed
   and assets failed turn red when non-zero.
7. The error code in monospace when present, then the gap list.

**Actions.**

- Sync now: `useSyncProgress({ channelId }).start()` with no arguments, which syncs only
  this channel. A local `starting` flag covers the window between the click and the job
  row existing, so a double click cannot race the database lock.
- Cancel: `cancelSyncAction(jobId)`.
- Open the sidebar panel: read-only view plus Cancel and Retry.
- External link, back link, and the tabs on the detail page all remain usable during a
  run. Nothing blocks navigation, and the run survives it because it is detached.

**System.** `startSyncAction(channelIds?)` in `src/server/actions/sync-actions.ts`
returns as soon as the engine wins the lock, not when the run finishes. It hands the
still-running promise to Next's `after()` so it outlives the response. The old design
awaited the whole sync inline, which held one POST open for minutes and lost the run on
reload.

`runSync()` in `src/server/services/sync-engine.ts`:

1. `acquireLock(channelId, lookbackDays)`. First reaps stale locks, then opens an
   IMMEDIATE SQLite transaction (taking the write lock at BEGIN), selects every
   `sync_jobs` row with `status = 'running'`, runs `conflictingRun()`, and inserts the new
   job row. The concurrency invariant: a run with `channel_id` set covers exactly that
   channel, a run with `channel_id` NULL covers the whole library, and two runs may hold
   locks simultaneously only when their covered sets are disjoint. A partial unique index
   on `sync_jobs(channel_id) WHERE status='running'` is the backstop. The reason this is
   strict: two syncs on one channel is a corruption problem, because `softDeleteMissing`
   compares the window against its own run's `seenExternalIds` and would mark the other
   run's unreached posts as deleted. Eight live @kallaway posts were already lost that
   way once.
2. `onJobStarted(jobId)` fires synchronously, before any network call, only on the
   winning side of the lock.
3. Channel rows are selected. With `channelIds` given, `inArray`. Without, every row where
   `platform = 'instagram'`.
4. Per channel, sequentially. Parallel bursts from a single Instagram session is what
   trips rate limiting, so the pacing is the point.
5. `syncOneChannel`: computes the boundary as `now - lookbackDays * 86400000`, fetches the
   profile, downloads the avatar, updates the `channels` row (including clearing
   `syncError` and `syncErrorCode` and setting `lastSyncedAt`), then pages `client.medias`
   newest-first with `sinceIso = boundary`, `maxItems = cap - itemsSeen`, and a cursor.
6. Per item: download the thumbnail, optionally download the video when
   `EAGER_VIDEO_DOWNLOAD` is true (default false, videos are fetched on first play),
   `upsertVideo` keyed on `(platform, external_id)`, `upsertChildren` for carousel slides
   keyed on `(video_id, position)`, and one row into `video_snapshots` with the view, like
   and comment counts at this moment. One bad post costs one item, not the channel.
7. Between pages: `sleep(jitterMs())`, 300 to 800 ms.
8. Stop reasons, in the order they are checked: `cap` when `itemsSeen` hits `maxItems`,
   then whatever the page reported (`lookback` when the boundary was crossed), then
   `exhausted` when there is no next cursor, then `cancelled`.
9. `softDeleteMissing` runs only when the stop reason was `lookback` or `exhausted` and at
   least one item was seen. Any other stop reason means the window was not fully
   enumerated, so marking absent posts as deleted would be a fabrication. A run that saw
   zero items explicitly refuses, and logs `sync.soft_delete.skipped`.
10. `recomputeChannelScores` rescores every non-deleted video for the channel over a
    20-video window, then one row goes into `channel_snapshots` with the follower count
    and median views.
11. `finalizeJob` writes the terminal row, but only if this run still owns it (guarded on
    `status = 'running'`). If a reaper already took the row, the counters are still
    written, the verdict is withheld, and `sync.finalize.reaped` is logged at error level.

Live progress: `createTracker(jobId)` flushes counters, phase, `currentChannelHandle`,
`channelsTotal`, `channelsDone` and `retries` to `sync_jobs` at every page and channel
boundary, plus `flushIfDue` inside the item loop when the row has been quiet for more
than `HEARTBEAT_MAX_SILENCE_MS` (30 seconds, one third of `SYNC_STALL_SECONDS`). The UI
polls `sync_jobs` every 1000 ms while running, every 10000 ms when idle, and not at all
when the tab is hidden.

Where the 90-day branch would go: `runSync` line reading
`const lookbackDays = opts.lookbackDays ?? config.LOOKBACK_DAYS`. A first-sync rule would
need a per-channel decision instead of a per-run one, because a library run covers
channels with different histories. The `sync_jobs.lookback_days` column already exists and
is already rendered by the panel, but it is written once per run, so a per-channel
lookback would make that column a lie.

**Failure.** Every code in the taxonomy can surface here as a gap. The gap row carries
`channelId`, `handle`, `provider` ("instagrapi"), the error message and the code, so the
UI can name the channel and offer the right recovery without a second query. Gap wording
comes from `GAP_MESSAGE` in `sync-progress-view.ts` and is deliberately different from
`IgError.userMessage`, because the connection panel's tense is wrong next to a channel
that has already failed.

Retry behaviour: `withRetry` retries only while `IgError.retryable` is true, up to
`SYNC_MAX_RETRIES` (default 3) with `SYNC_RETRY_BASE_MS` (default 1000). Total time spent
guessing at a backoff is capped at `baseMs * maxRetries`, so a dead upstream costs a few
seconds per call rather than an ever-doubling wait. A wait Instagram actually asked for
(`detail.retry_after_sec`) is exempt from that budget and capped at `MAX_BACKOFF_MS`, 300
seconds. `IG_SERVICE_DOWN` gets exactly one retry, because a localhost sidecar is either
coming up right now or is not running at all.

Gap retry labels: `gapRetryLabel` returns "Retry anyway" instead of "Retry" for
`IG_NOT_FOUND`, `IG_PRIVATE`, `IG_DRIFT` and `IG_BAD_CREDENTIALS`, where nothing about a
retry can change the outcome.

Terminal statuses: `success` when there are no gaps and nothing was left undone,
`partial` when there are gaps or a cancel left work undone but at least one channel
survived, `failed` when there were gaps and zero channels synced. That last rule exists
because a run where every channel failed used to record `partial`, so the UI reported
partial success for a total failure.

**Empty.** A first sync of a channel with no posts in the window finishes with
`itemsSeen = 0`, stop reason `exhausted` or `lookback`, status `success`, and every
counter at zero. The soft-delete is skipped and logged. The channel detail page then
shows "No reels tracked yet." in the Recent Reels tab. This is @hormozi's current state
except that it has never been synced at all.

**Open question.** The deep first sync itself: 90 days on first sync and 30 after is not
implemented and needs Kai's final call. If it lands, three sub-questions follow. Should
"first sync" mean `lastSyncedAt IS NULL`, or should it mean the channel has no videos,
given that `addChannel` sets `lastSyncedAt` on a successful profile fetch even though no
posts were fetched? Should the 200-post cap rise for the deep run, since 90 days of a
prolific creator will hit the cap and stop with `cap`, which then suppresses the
soft-delete? And should `sync_jobs.lookback_days` become per-channel, since a library run
with mixed lookbacks currently has one column for a value that would differ per channel?

---

### B3. Batch sync, the N stalest channels per run

**This flow is not implemented.** There is no batching, no staleness ordering and no
scheduler. Today `start()` with no channel ids calls `runSync({})`, which selects every
row where `platform = 'instagram'` and walks all of them sequentially in one job. With 2
channels that is invisible; with 40 it is the problem this flow exists to solve. The
Settings sync section says so out loud: `SYNC_INTERVAL_MINUTES` is validated at boot and
read by nothing, and the row renders "manual only" in red with a note saying a sync only
ever starts from a click.

Everything below is a proposal.

**Entry.** Proposed, three entries:

- The sidebar's sync block, "Sync now", which today means everything and would come to
  mean the next batch.
- Settings, the Sync section's "Sync now" button.
- A future scheduler tick, if `SYNC_INTERVAL_MINUTES` is ever made real.

**Screen.** Proposed. The existing `SyncProgressPanel` already renders this correctly
without changes, because `channelsTotal` would be the batch size rather than the library
size and the bar is drawn from `channelsDone / channelsTotal`. What needs adding:

1. A line above the bar naming what this run covers, for example "Syncing 4 of 12 tracked
   channels, stalest first". Without it, a bar reading 2 / 4 in an app with 12 channels
   looks like a bug.
2. The channels table gets a "Last synced" column it already has, but the ordering
   currently comes from `getChannelsList()` and is unknown here. A staleness-ordered
   default would make the batch selection legible without extra UI.
3. After the run, a line saying which channels are queued next, or how many remain
   unsynced this cycle.

**Actions.** Proposed:

- Sync now: starts a batch of N.
- A "Sync all" escape hatch that ignores batching, for the case where Kai genuinely wants
  everything and will wait. Without it, the only way to force a specific channel is the
  per-channel Sync now, which does not scale to 12 channels.
- Per-channel Sync now stays exactly as it is and is unaffected by batching.

**System.** Proposed. N is 3 to 5, from the settled decisions. The selection query:
channels ordered by `last_synced_at` ascending with nulls first (never-synced channels are
maximally stale), limit N, filtered to `platform = 'instagram'`.

The problem this collides with is the concurrency invariant. A batch run covers a subset
of channels, but `sync_jobs.channel_id` can only hold one id or NULL, and NULL means "the
whole library" to `conflictingRun()`. So a batch of 4 would have to either register as a
library run (blocking every per-channel sync for its duration, which is what a library run
does today) or gain a real representation of its covered set. Options:

- Keep `channel_id` NULL and accept that a batch blocks per-channel syncs. Simplest, and
  matches current behaviour, but it means Kai cannot force-sync one channel while a batch
  is walking.
- Add a `sync_job_channels` join table and make `conflictingRun()` compare sets. Correct,
  and more work.
- Run each channel in the batch as its own job, staggered. Then `channel_id` stays exact
  and the invariant holds unchanged, but the progress panel loses its single-run view and
  the sidebar has N runs to summarise instead of one.

The pacing between channels within a run already exists: sequential channels plus 300 to
800 ms of jitter between pages. The word "staggered" in the settled decision may mean
something stronger, for example a fixed gap between channels or between batches. Unknown
which.

**Failure.** Proposed. Batching interacts badly with the account-wide rate-limit cooldown
(see B4). If channel 2 of 4 hits `IG_RATE_LIMITED`, the sidecar persists a cooldown that
applies to the whole account, so channels 3 and 4 will fail too, and the run ends as
`partial` with three gaps that all say the same thing. The panel would show three
identical "Instagram is throttling us" rows. A batch run should probably stop early on
`IG_RATE_LIMITED` rather than burning the remaining channels into gaps, and say so.
Same for `IG_AUTH_REQUIRED`, `IG_BAD_CREDENTIALS`, `IG_CHALLENGE`, `IG_TWO_FACTOR` and
`IG_SERVICE_DOWN`: all are account-level or process-level, and none of them will be
different for the next channel in the batch.

**Empty.** No channels tracked: the batch selects zero rows, `channelsTotal` is 0, and
`channelPercent` returns null because `total <= 0`, so the bar goes indeterminate with
"resolving channels" forever until the run finalizes. That is a real rendering bug the
proposal has to handle: a run with zero channels should say so.

**Open question.** The largest cluster of open questions in this document.

- Is N fixed at 3 to 5, or does it adapt (fewer when the last run hit rate limits, more
  when everything succeeded)?
- Which of the three concurrency representations above does Kai want? This is the one that
  determines the amount of work, because two of the three touch the locking invariant.
- Does "staggered" mean a delay between channels inside one run, a delay between batch
  runs, or both? What delay?
- Should a batch stop early on an account-wide error, and should the remaining channels be
  recorded as skipped rather than failed? There is no "skipped" concept in `SyncGap`
  today.
- Is there a scheduler in v1 at all, or is batching purely about what one click does?
  `SYNC_INTERVAL_MINUTES` exists and is inert; making it real means a background loop in a
  Next dev server, which is its own set of problems.

---

### B4. Sync failure and recovery

**Entry.** Kai does not navigate here. A run he started fails, and the failure surfaces
wherever he happens to be: the sidebar rail, the channel header, the channels table row,
or the Settings sync section.

**Screen.** Four surfaces show the same underlying `sync_jobs` row, worded for their
space:

1. **Sidebar rail.** `railLabel` reads "Sync failed <relative time>", "Partial sync
   <relative time>", "Sync stalled" or "Sync cancelled". The dot colour comes from
   `VIEW_STATE_DOT`: failed and stalled are red `#F1585C`, partial and cancelled are amber
   `#E8B23D`, running and cancelling are amber, success is green `#34D399`, never is grey.
   Stalled takes red on purpose, because amber would read as "still going".
2. **`SyncProgressPanel`**, in the sidebar dialog and in Settings. Headline plus detail
   plus the gap list, each gap with its own sentence, its own monospace error code, and
   its own Retry button. A header button reads "Retry N failed" and retries exactly those
   channel ids.
3. **`ChannelHeader`.** Only this channel's own failure. A destructive alert with the gap
   message and a Retry button labelled by `gapRetryLabel`. A library run that gapped on
   somebody else is not repeated here.
4. **`ChannelTable`.** A red warning triangle next to the "Last synced" cell, with the gap
   message in a tooltip. A gap from the run that just finished wins over the `sync_error`
   persisted on the channel row, because it is fresher.

The panel's state machine (`syncViewState`) has eight states: idle, running, stalled,
cancelling, cancelled, success, partial, failed. Two rules in it are load-bearing.
Stalled outranks cancelling, because a dead process will never honour a cancel. And
`failed` plus stop reason `cancelled` is reported as a failure, not a cancellation: two
rows in the live database were `failed | cancelled | IG_NETWORK` with zero channels
synced and used to render as a benign amber cancellation.

**Actions.**

- Retry (per gap): `start([channelId])`.
- Retry N failed: `start(gaps.map(g => g.channelId))`.
- Start a new sync (stalled state only): `start()` with no ids. The button exists in that
  state specifically because a stalled run is probably a dead process holding the lock.
- Cancel: `cancelSyncAction(jobId)` while running.
- Re-check / Connect, in the Instagram section, for the codes that need it.

**System.** The recovery paths per failure class:

**Rate limit cooldown.** `services/ig/crowsnest_ig/ratelimit.py`. Full-jitter exponential
backoff: `BASE_SECONDS = 60`, `CAP_SECONDS = 1800` (30 minutes), `MAX_ATTEMPTS = 5`.
Attempt 1 draws uniformly from 0 to 60 seconds, attempt 2 from 0 to 120, and so on, with
the ceiling capped at 30 minutes. The backoff is deliberately not slept inside the HTTP
request, because Node calls the sidecar with a 30 second `AbortSignal` and sleeping 60
seconds to 30 minutes in-request would guarantee a client-side timeout that hides the real
cause. Instead the decision is persisted as a deadline in a JSON file (`until`, `attempt`,
`reason`, written atomically via a `.tmp` file and `os.replace`) and returned to the
caller as `IG_RATE_LIMITED` plus `retry_after_sec`.

Three consequences worth stating plainly. The cooldown is account-wide, not per channel,
so one throttled channel blocks the whole account. It survives a restart, so restarting
the sidecar does not reset the escalation or let it immediately hammer Instagram. And the
attempt counter decays: `Cooldown.attempt()` returns 0 once the deadline is more than
`CAP_SECONDS` in the past. The current deadline surfaces in the UI as the "Rate-limit
cooldown" row in the connected state of the Instagram panel, showing the raw
`cooldownUntil` timestamp.

On the Node side, `backoffMs()` honours `detail.retry_after_sec` when the sidecar sends it
(capped at 300 seconds) rather than guessing a shorter wait, because guessing shorter just
spends the quota again. While backing off, the job row's phase reads `retrying` and the
panel headline reads "Backing off after an upstream error". The retry count appears in the
meta line as "retried N times", placed with the neutral facts rather than with the errors,
because a retry that succeeded is recovery, not failure.

**Session expired.** `IG_AUTH_REQUIRED`. Marked `needsUserAction`, not retryable, so
`withRetry` fails on the first attempt. The gap message says the Instagram session has
expired, to re-import it in Settings, then retry this channel. The channel's
`sync_error` and `sync_error_code` columns are written. Recovery is A2: go to Settings,
Connect, resolve any 2FA or challenge, come back and Retry. Nothing clears
`sync_error` except a later successful sync of that channel, which sets both columns to
null at the point the profile fetch succeeds.

**IG_NETWORK.** Retryable. `withRetry` gives it up to `SYNC_MAX_RETRIES` (3) attempts
with a jittered exponential backoff off `SYNC_RETRY_BASE_MS` (1000 ms), total guessing
budget 3 seconds. If it still fails, the channel becomes a gap with the message that the
network call to Instagram failed and is usually transient. Retry is offered as a plain
"Retry".

**Channel gone.** `IG_NOT_FOUND`. Not retryable, not `needsUserAction`. The gap message
says the account no longer exists on Instagram and that this is about the account, not
about this app. The retry button reads "Retry anyway", because nothing about a retry can
change the outcome, but the button still exists in case Kai knows something the app does
not. Nothing untracks the channel: there is no untrack feature (see the Actions notes in
B5), so a dead channel stays in the table with a permanent warning icon.

**Stalled run.** `isSyncStalled` compares `heartbeat_at` against `SYNC_STALL_SECONDS`, 90
seconds. The panel's detail text for this state is carefully hedged and the hedge is the
point: it says the run has probably died holding the lock but may yet recover, because the
stale-lock reaper waits `LOCK_STALE_MS` (90 * 10 = 900 seconds, 15 minutes) before
stealing the lock. Inside that window a run that looks stalled can still be alive. When
the reaper does fire, it flips the row to `failed` with `errorCode = "SYNC_ABANDONED"` and
the message that the job had no heartbeat and is assumed crashed.

**A second sync while one is running.** `SyncAlreadyRunningError`, code
`SYNC_ALREADY_RUNNING`. Surfaced as a toast in the channels table (deduped via
`toastedErrorRef`, because a poll error survives across polls by design and re-toasting
every second would build a tower of identical messages). The UI mostly prevents this by
disabling the buttons, using `coverage` from the `channel_id` column rather than a handle
comparison.

**Poll failure.** `reducePoll` keeps the last good row on screen and shows the error
alongside it, rather than blanking a half-rendered sync because one fetch lost its
connection. The panel renders "Progress updates are failing: <error>" plus a note that
the numbers above are the last ones that arrived.

**Failure.** This flow is the failure flow. The codes not covered above:

- `IG_PRIVATE`: not retryable, "Retry anyway", message says the account is private so its
  posts cannot be read.
- `IG_BAD_CREDENTIALS`: `needsUserAction`, "Retry anyway", message says to fix them in
  Settings before retrying.
- `IG_TWO_FACTOR` and `IG_CHALLENGE`: `needsUserAction`, plain "Retry", message points at
  Settings.
- `IG_PROXY_BLOCKED`: `needsUserAction`, message says to change or remove `IG_PROXY` in
  `.env.local`.
- `IG_ASSET_DOWNLOAD`: retryable. Posts were read but an image or video would not
  download. Counted in `assetsFailed` rather than failing the post, and a retry picks up
  the missing files. A transient download failure cannot wipe a good thumbnail, because
  `upsertVideo` keeps the existing `thumbnailAssetId` when the new one is null.
- `IG_DRIFT`: not retryable, "Retry anyway". Instagram's response no longer matches what
  the mapper expects, and the fix is a code change.
- `IG_SERVICE_DOWN`: retryable but capped at one retry. Message names
  `npm run ig:service`.
- `IG_SERVICE_UNAUTHORIZED`: the app and the sidecar disagree about `IG_SERVICE_TOKEN`.
  Message calls it a config fault on our side and points at `.env.local`.
- `IG_UNKNOWN`: falls through to whatever prose the engine recorded. `gapMessage` never
  renders a bare code, and if there is no message either it says the sync engine recorded
  no reason.
- `SYNC_ALL_CHANNELS_FAILED`: written to `sync_jobs.error_code` only when every channel
  failed and the first gap had no code of its own.

**Empty.** With `sync_jobs` empty (the current real state), every failure surface is
quiet: grey dot, "Never synced", "No sync has run yet", and the Settings summary reads
that there is no `sync_jobs` row to report.

**Open question.** Should the account-wide cooldown be visible outside the Instagram
panel? Right now a rate limit shows as a per-channel gap message saying to leave it a few
minutes, while the real deadline (which can be up to 30 minutes and escalates across
restarts) is only visible as a raw timestamp in Settings. Second: nothing surfaces the
attempt counter, so Kai cannot tell whether he is on attempt 1 of 5 or attempt 5 of 5,
and attempt 5 is where the sidecar reports `attempts_exhausted`. Third: is there a point
at which a channel that has failed N syncs in a row should be flagged or auto-paused
rather than retried forever?

---

### B5. Channel detail, browsing one creator's catalog

**Entry.** Clicking a row in the channels table (the whole row is a link, keyboard
accessible with Enter), or "View" in the row dropdown. Route is `/channels/<channelId>`.
The id is the internal database id, not the handle.

**Screen.** `src/app/(shell)/channels/[channelId]/page.tsx`, max width 1120px, top to
bottom:

1. A back link, a chevron and the word "Channels", pointing at `/channels`. It lives in
   page content rather than the topbar, because the phase-1 topbar renders a static
   "Channel Detail" h1 and does not do dynamic breadcrumbs.
2. `ChannelHeader`. Covered in B2: avatar, handle, platform pill, follower count,
   external link, live sync readout, Sync now, cancel X, disabled Untrack, and a
   destructive alert when this channel has a failure.
3. A four-column grid of stat tiles: "Median views", "Best multiplier", "Outliers (30d)",
   "Videos tracked". Sentence-case label, semibold compact value, tabular numerals. No
   deltas and no sparklines here, because the chart below covers trend.
4. "Outlier history", an h2, then `OutlierHistoryChart` fed by `detail.series`.
5. A tab group with three tabs: "Recent Reels", "Outliers Only", "In Vault". Each renders
   a `ChannelVideoGrid` with its own empty label.

**Actions.**

- Back link to `/channels`.
- External link icon: opens the live Instagram profile in a new tab, with
  `rel="noopener noreferrer"`. The URL is derived from the stored handle, because the
  schema has no profile URL column.
- Sync now / cancel: see B2.
- Untrack: rendered as a disabled outline button with `focusableWhenDisabled`, wrapped in
  a tooltip reading that untrack arrives in a later phase. The table's dropdown version is
  not disabled and instead fires an informational toast with the same sentence, because
  Base UI's disabled item styling sets `pointer-events: none`, which would block a
  tooltip's hover.
- Tab switching: client-side, no refetch. All three lists are computed from the same
  `detail.videos` array already on the page.
- Clicking a video in the grid: goes to the video detail route (`/feed/<videoId>`).

**System.** `getChannelDetail(channelId)` in `src/server/queries/channels.ts` returns the
channel row, its videos, its stats and its series. A null result calls `notFound()`.
`getVaultedVideoCounts()` returns a Map of video id to template count, used both to filter
the In Vault tab and to badge the cards.

The two derived lists are computed in the page:

- Outliers only: `detail.videos.filter(v => v.outlierScore !== null && v.outlierScore >= 2)`.
  The 2x threshold is hardcoded here and matches the "Outliers (2x+)" empty label.
- In Vault: videos whose id appears in `templateCounts`.

Outlier scores are written by `recomputeChannelScores` at the end of each channel's sync,
over a 20-video window (`SCORE_WINDOW`), against the channel's own median. The median
itself comes from `computeChannelMedian` and is written into `channel_snapshots` alongside
the follower count, which is what feeds the history chart.

Soft-deleted videos (`videos.deleted_at` non-null) are excluded from scoring. Whether they
are excluded from `detail.videos` is unknown from the page itself and lives in the query.

**Failure.**

- Unknown channel id: `notFound()`, so Next renders the 404 page. There is no "this
  channel was untracked" state, because untrack does not exist.
- A channel with a recorded `sync_error`: the header alert renders the mapped gap message,
  and the table row keeps its warning icon.
- Missing avatar asset: `AvatarFallback` renders the first letter of the display name or
  handle, uppercased, with the `@` stripped.
- A thumbnail asset that failed to download: the card renders without an image. The video
  row still exists, because a dead thumbnail costs one asset, not the post.
- Null `viewCount` on a video: `formatCompact` handles it, and `scoreVideos` treats it as
  unscoreable. Note the upsert rule that protects this: a metric Instagram withheld this
  time (null) never erases one already stored. Instagram returns 0 for other creators'
  play counts in many contexts, and that wiped a genuine 2.27M-view figure on the first
  live run.

**Empty.** Three distinct empty states, one per tab, each with its own sentence: "No reels
tracked yet." for Recent Reels, "No outliers (2x+) yet." for Outliers Only, and "No
templates saved from this channel yet." for In Vault. This is @hormozi's exact current
state: a channel row with zero videos, so all three tabs are empty, all four stat tiles
read zero, and the history chart has no series.

The stat tiles and the chart always render, even at zero. A never-synced channel therefore
shows four zeroes and an empty chart, with nothing on the page explaining that it has
never been synced. The header's Sync now button is the only affordance, and it does not
look like a call to action.

**Open question.** Should a never-synced channel get a distinct empty state, the way the
Dashboard does, instead of four zeroes and an empty chart? Second: the 2x outlier
threshold is hardcoded in this page and the label says "2x+", but the outlier definition
belongs to the product, not to one route. Should it be configurable, and if so, where?
Third: untrack is promised by two separate pieces of UI copy that both say "a later
phase", which is the same kind of stale promise the fleet rail's old disabled button made.
Is untrack in v1 or not?

---

### B6. Fleets, creating one and assigning channels

**Entry.** `/channels`. The fleet rail is the 180px left column of the page, inside the
1120px container, with a right border.

**Screen.** `FleetRail` in `src/components/channels/fleet-rail.tsx`, top to bottom:

1. A small muted label "Fleets".
2. "All channels" with the total channel count on the right, tabular numerals. Active
   (secondary background, full-contrast text) when there is no `fleet` search param.
3. One row per fleet: the name, truncated, with its channel count on the right. Active
   when `searchParams.get("fleet")` matches its id.
4. A ghost "New fleet" button with a plus icon, left-aligned, muted.

To the right, the channel list area: the "+ Channel" button right-aligned above the table,
then `ChannelTable` with columns Channel (avatar plus handle), Platform, Followers (right
aligned), Median views (right aligned), Outliers (30d) (right aligned), Last synced, and a
narrow actions column.

`NewFleetDialog`: title "New fleet", description "Group channels into a named watchlist.",
a Name field with the placeholder "Fitness Niche", and a Create button disabled until the
name is non-empty after trimming.

`EditChannelFleetsDialog`: title "Edit fleets for @handle", description "Choose which
fleets this channel belongs to.", then a checkbox per fleet pre-checked from the channel's
current membership, then a Save button. With no fleets it shows the line "No fleets yet,
create one from the Fleets rail first." and the Save button is disabled.

**Actions.**

- Click a fleet: navigates to `/channels?fleet=<id>`. The rail preserves every other
  search param when building the href, and deletes the `fleet` param for the All channels
  link.
- New fleet, Create: `createFleetAction(name)`, then a success toast "Fleet created", the
  dialog closes and `router.refresh()` re-reads the server data so the rail shows the new
  fleet immediately.
- Row dropdown, "Edit fleets": opens `EditChannelFleetsDialog` for that channel. One
  shared dialog instance for the whole table, keyed by the selected channel id, rather
  than one dialog per row.
- Save in that dialog: `setChannelFleetsAction(channelId, fleetIds)`, toast "Fleets
  updated", close, `router.refresh()`.
- What does not exist: rename a fleet, delete a fleet, reorder fleets, assign several
  channels at once, or create a fleet from inside the edit dialog. `fleet-actions.ts`
  says this is deliberate: two mutations, the minimum needed to actually use the feature.

**System.** `createFleetAction(name)` trims, rejects an empty name with "Fleet name can't
be empty.", and inserts one row into `fleets` with a new id, the trimmed name and
`createdAt`. There is no uniqueness constraint mentioned, so two fleets can share a name.

`setChannelFleetsAction(channelId, fleetIds)` replaces the channel's entire membership
set: it deletes every `fleet_channels` row for that channel, then inserts one row per
selected fleet. Delete-then-insert rather than additive, because the UI is a checkbox list
where the caller always knows the full intended set. Note this is not wrapped in a
transaction in the code shown, so a failure between the delete and the insert would leave
the channel in no fleets.

The page reads fleets and channels in parallel: `getFleets()`, `getChannelsList()` for the
total, and `getChannelsList(fleetId)` when a fleet param is present. The unscoped list is
always fetched, because the rail's "All channels" count needs it.

Fleets already feed two other surfaces: the Feed's fleet filter, and the Dashboard's fleet
spike row (`getFleetSpikes`). So a fleet created here changes what those show.

**Failure.**

- Empty or whitespace-only name: the Create button is disabled, so the action's own
  validation is a backstop rather than the path the user hits.
- Duplicate name: succeeds silently and creates a second fleet with the same name. The
  rail then shows two identical-looking rows distinguished only by their counts.
- Database write failure: the action catches and returns `{ ok: false, error }`, rendered
  as a destructive toast.
- A `fleet` search param that names no fleet: `getChannelsList(fleetId)` returns an empty
  list, so the table shows "No channels in this fleet yet." and no rail row is highlighted.
  There is no "that fleet does not exist" message.
- Editing fleets for a channel while a sync is running: unaffected, they touch different
  tables.

**Empty.**

- No fleets: the rail shows only "All channels" and the "New fleet" button. The edit
  dialog, if opened, shows its own empty line and a disabled Save.
- A fleet with no channels: the rail row shows a count of 0, and selecting it renders "No
  channels in this fleet yet.", which is the one place that copy is actually correct.
- No channels at all: same empty table, wrong copy (see B1).

**Open question.** Is one fleet per channel the mental model, or many? The schema and the
UI both support many (a checkbox list, a join table), but nothing in the product explains
what belonging to two fleets means for the Feed filter or the Dashboard spike row.
Second: rename and delete are missing, and a fleet named by mistake is currently
permanent. Third: assigning channels one at a time through a row dropdown does not scale
past a handful of channels, and there is no multi-select on the table. Fourth: should
fleets have any effect on sync at all, for example "sync this fleet", which would be a
natural fit with the B3 batching proposal.
