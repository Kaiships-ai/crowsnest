# Settings page deep test plan, 2026-08-01

Modeled on `2026-08-01-feed-deep-test-plan.md`: grounded in a real code read of the
Settings route, not a guess, then read-only browser cases against
`http://localhost:3000`.

Files read: `src/app/(shell)/settings/page.tsx`, every component under
`src/components/settings/`, `src/server/settings/index.ts`,
`src/server/secrets/store.ts`, `src/server/actions/secrets-actions.ts`,
`src/server/actions/settings-actions.ts`, `src/server/actions/sidecar-actions.ts`,
`src/server/sidecar/control.ts`, `src/server/actions/ig-actions.ts`,
`src/server/ig/client.ts`, `src/server/actions/graph-actions.ts`,
`src/server/graph/client.ts`, `src/server/llm/client.ts`,
`src/server/lib/exec.ts`, `src/server/transcribe/whispercpp.ts`, plus the current
`.env.local` and a read-only query of the local `data/crowsnest.db` to know which
findings are live in this exact dev environment versus which need a fixture.

Already known and not re-reported here, per the assignment: settings marked
`WIRED: false` (Feed defaults' two rows) are honestly labeled as not read, and the
Scoring section's own copy does not repeat the "about 10 posts" line (that mismatch
lives in `channel-table.tsx`, outside this route).

Every case below is read-only. No case clicks Stop/Start sidecar, Disconnect,
Regenerate token, Save/Clear a secret, submits a session ID, or confirms a
destructive dialog (Rescore, Replay first run). The Anthropic key "Test" is included
per the brief: it is a `count_tokens` call that spends no generation quota and
writes nothing.

## Bug candidates found in this code read

### 1. Most severe: a fully logged-in sessionid-only connection can show "No Instagram credentials configured"

`src/components/settings/instagram-section.tsx:44-69`, `viewStateOf`:

```
if (!statusResult.status.credentialsConfigured) return "no_credentials";
if (!statusResult.status.loggedIn) return "logged_out";
return "connected";
```

`credentialsConfigured` is `health.canLogin`
(`src/server/actions/ig-actions.ts:118`), and `canLogin`'s own doc comment in
`src/server/ig/client.ts:296-298` says exactly what it means: both `IG_USERNAME` and
`IG_PASSWORD` are configured on the sidecar. It has nothing to do with a session
cookie.

But this same section's own UI (`instagram-section.tsx:269-306`) offers "Sign in
with a session token" as the "Recommended" connect path specifically because it
skips password login entirely, per its own copy: the text on screen tells a user
they do not need `IG_USERNAME`/`IG_PASSWORD` at all. A sidecar that only ever
received a sessionid (never a username or password) reports `canLogin: false`
honestly, and reports `logged_in: true` just as honestly once the session is
adopted. `viewStateOf` checks `credentialsConfigured` first and returns early: a
real, active, fully-authenticated session is reported as "No Instagram credentials
configured," the single most alarming state the panel has, instead of "Connected as
@username." The `loggedIn` flag is never consulted in that branch.

Real bug, not expected behavior: nothing in `services/ig`'s login flow requires
`IG_USERNAME`/`IG_PASSWORD` once a sessionid is adopted, so this is a realistic,
supported configuration the state machine gets backwards.

Needs fixture: this dev environment's `.env.local` sets both `IG_USERNAME` and
`IG_PASSWORD` (confirmed by reading the file), so `canLogin` is `true` here and the
bug is masked. It needs a sidecar started with only `IG_SESSIONID` configured (no
`IG_USERNAME`/`IG_PASSWORD` in its env) to observe directly. Verdict from code
alone: confirmed. The ordering in `viewStateOf` is unconditional and does not depend
on any environment specifics; only the masking in this particular dev environment is
fixture-dependent.

### 2. The Anthropic key "Test" button can report success without ever reaching Anthropic

`src/components/settings/secrets-section.tsx:107-113` (`runTest`) calls
`testAnthropicKeyAction` (`src/server/actions/settings-actions.ts:96-105`), which
calls `getLlm().ping()`. `getLlm()` (`src/server/llm/client.ts:232-241`) builds an
`Anthropic` client with `baseURL: process.env.LLM_BASE_URL` whenever that variable
is set, and returns a `CompatLlmClient` instead of the native one
(`isCompatMode()`, `llm/client.ts:219-221`). `CompatLlmClient.ping()`
(`llm/client.ts:183-188`) calls the exact same `messages.countTokens(...)` method,
just routed through that base URL.

This dev environment's `.env.local:21` sets `LLM_BASE_URL=http://localhost:20128`,
compat mode is live here right now. Clicking "Test" therefore checks whether the
local proxy accepts a `count_tokens` call, not whether `api.anthropic.com` accepts
the stored `ANTHROPIC_API_KEY`. The toast text is identical either way ("Anthropic
API key: connection OK"): nothing on the API Keys panel, anywhere in
`secrets-section.tsx`, ever surfaces that generation is proxied. A user reading
"connection OK" would reasonably conclude their real Anthropic key works; what it
actually proves is that the local router is up and accepted whatever key was sent,
which local relay proxies do not necessarily validate against the real upstream at
all. The reverse failure mode is just as real: if the proxy does not implement
`count_tokens` (a plausible gap for a router built primarily for chat completions),
"Test" would report failure even though `generateText`/`generateParsed`, the calls
that actually matter for the product's AI features, work fine through the same
client. Either direction, the single word "OK" or error on this button does not mean
what its label implies once `LLM_BASE_URL` is set, and the UI gives no hint that
mode is active. Real bug, testable today.

### 3. Sync section's "read from env" note overclaims for two rows that were never actually set by any env var

`src/server/settings/index.ts:158-163`:

```
const ENV_FALLBACK: Partial<{ [K in keyof AppSettings]: () => AppSettings[K] }> = {
  syncLookbackDays: () => config.LOOKBACK_DAYS,
  maxItemsPerSync: () => config.MAX_ITEMS_PER_SYNC,
  syncCadenceMinutes: () => config.SYNC_INTERVAL_MINUTES,
  mediaRetentionDays: () => config.MEDIA_RETENTION_DAYS,
};
```

`resolve()` (`settings/index.ts:203-214`) reports `source: "env"` for any key with an
`ENV_FALLBACK` entry, whenever there is no db row, regardless of whether the
underlying OS environment variable was ever actually set. `config.ts`'s own schema
(`src/server/config.ts:44-46,60`) gives `SYNC_INTERVAL_MINUTES` and
`MEDIA_RETENTION_DAYS` built-in defaults (`0` and `90`) when the var is absent, so
"resolved via `config.ts`, which has its own default" and "genuinely read from an
env var" are conflated into the same `"env"` source label.

`src/components/settings/sync-section.tsx:201-205` (`envNote`) then renders, for any
key whose source is `"env"`: "Currently read from SYNC_INTERVAL_MINUTES. Save below
to store an override in the database." naming a specific variable as the current
source.

Confirmed live in this exact dev environment: `.env.local` has no
`SYNC_INTERVAL_MINUTES` and no `MEDIA_RETENTION_DAYS` line at all (grepped), and
`data/crowsnest.db`'s `app_settings` table has no `sync_cadence_minutes` or
`media_retention_days` row either (queried read-only). Both rows will still show the
`"env"` info note naming a variable that does not exist anywhere in this process's
environment; the value on screen (0 min, 90 days) is `config.ts`'s hardcoded
default, not anything read from an env var. Contrast with the secrets store
(`src/server/secrets/store.ts:58-64`), whose `"env"` source label only ever fires
when `process.env[name]` is actually non-empty: the secrets panel does not have this
problem, only the four `app_settings` keys with an `ENV_FALLBACK` entry do (two of
the four, `syncLookbackDays`/`maxItemsPerSync`, happen to be genuinely env-sourced in
this environment since `LOOKBACK_DAYS=30` and `MAX_ITEMS_PER_SYNC=200` really are
set; only the other two are affected).

### 4. IG_SERVICE_TOKEN "Regenerate" carries no warning that it can desync a live sidecar, and this environment is in exactly that state right now

`src/components/settings/secrets-section.tsx:131-134` always renders the
"Regenerate" control for `IG_SERVICE_TOKEN`, independent of `status.source`.
`regenerateServiceTokenAction` (`src/server/actions/secrets-actions.ts:63-67`)
unconditionally writes a fresh random token to the db. Once that write happens,
`getSecret("IG_SERVICE_TOKEN")` (db-first, `secrets/store.ts:37-42`) returns the new
value for every future call this Node process makes, but a sidecar process that is
already running keeps whatever token was baked into its own process environment at
spawn time (`services/ig` reads it once, at boot, the way any Python process reads
its env). The two processes silently disagree until the sidecar is restarted,
surfacing later as `IG_SERVICE_UNAUTHORIZED` on some unrelated action, with nothing
on the Regenerate button or its confirmation-free click warning that this can
happen.

Confirmed live in this exact dev environment: `data/crowsnest.db`'s `secrets` table
has no `IG_SERVICE_TOKEN` row at all (queried read-only), only `ANTHROPIC_API_KEY`
and `IG_SESSIONID` have db rows. That means the token's current source is `"env"`
(from `.env.local`'s `IG_SERVICE_TOKEN=...` line), and there is a real sidecar
process running right now under that same env-sourced token (confirmed via `ps`:
pid 84857 tracked in `data/sidecar.pid`, a live `crowsnest_ig` child at pid 84862).
Clicking Regenerate in this exact state would immediately break that connection.
This case is not exercised here, Regenerate is on the forbidden list, but the
precondition for the bug (token source `"env"`, sidecar already running under it) is
independently, read-only confirmable on the page and is true right now.

### 5. The API keys panel's "Configured" badge for IG_USERNAME/IG_PASSWORD does not describe what the running sidecar actually has

`src/server/sidecar/control.ts:20-32` (`childEnv`) only reads
`IG_USERNAME`/`IG_PASSWORD` from the secrets store at the moment `startSidecar()` is
called. A sidecar already running, whether started by a previous click of this
app's own Start button before a credential change, or started outside the app
entirely via `npm run ig:service`, keeps whatever values it received at its own
boot time. The API Keys section (`secrets-section.tsx`) reports "Configured" purely
from the store's current value (`secretStatus()`,
`src/server/secrets/store.ts:58-64`), with no cross-check against, or even mention
of, what the live process actually has. These are two independently truthful,
independently rendered signals: the secrets panel's row and the Instagram
connection panel's `credentialsConfigured` (itself a separate live health call, see
finding 1), with no code path reconciling them and no UI copy warning that they can
diverge. Needs fixture (change a credential in Settings after the sidecar is
already running, without restarting it) to observe the divergence directly; the
gap between the two data sources is confirmed by code alone.

### 6. Local binaries: yt-dlp's "not found" reason is a fixed generic string, whisper's is not

`src/app/(shell)/settings/page.tsx:66-69`:

```
const binaries: BinaryStatus[] = [
  { label: "yt-dlp", available: ytdlpPath !== null, reason: ytdlpPath === null ? "not found on PATH" : undefined },
  { label: "whisper-cli (+ model)", available: whisper.available, reason: whisper.reason },
];
```

`ytdlpPath` comes from `detectBinary(process.env.YTDLP_BIN_PATH ?? "yt-dlp")`
(`src/server/lib/exec.ts:33-43`). If `YTDLP_BIN_PATH` is set to a specific,
misspelled, or otherwise-broken path, the reason shown is still the generic
"not found on PATH," which does not mention that a custom path was configured or
what it was. Contrast with `whisperAvailability()`
(`src/server/transcribe/whispercpp.ts:23-44`), whose reason strings are specific
either way ("whisper-cli not found on PATH..." vs "whisper model not found at
`<path>`..."). Not observable in this dev environment: `YTDLP_BIN_PATH` is unset in
`.env.local`, and `yt-dlp` resolves fine on `PATH` here (confirmed via `command -v
yt-dlp`), so the reason string never renders at all right now. Needs fixture (set
`YTDLP_BIN_PATH` to a bad path) to see the misleading generic message; confirmed by
code alone otherwise.

## Read-only browser test cases (http://localhost:3000/settings)

### A. Instagram connection vs credentials (finding 1)

#### TC-SET-A1: Sessionid-only connection state, code-verified only
Steps:
1. Go to `/settings#instagram`.
2. Read the connection panel's current state and, if connected, the `dl`/`dd` detail
   list under it (instagrapi version, Session file, Service, cooldown).
Expected: needs fixture. This dev environment's sidecar has both
`IG_USERNAME`/`IG_PASSWORD` and `IG_SESSIONID` available, so `credentialsConfigured`
is `true` and the described bug cannot appear here. Record whatever state is
actually shown (most likely "Connected as @<username>" given the session file on
disk) as a baseline, not as a pass/fail on finding 1. Verdict on finding 1 itself
comes from the code read in section 1 above: confirmed.

#### TC-SET-A2: Sign-in copy still claims sessionid skips password login entirely
Steps:
1. From `/settings#instagram`, if the panel is not already in the "connected" view,
   read the "Sign in with a session token" card's body text.
2. If the panel is in the "connected" view, note that this card is not rendered at
   all (per `instagram-section.tsx:269`, `{view !== "connected" && (...)}`).
Expected: read-only confirmation of the wording relied on in finding 1 ("This skips
password login entirely, so it can't trip the failed-login count..."). No claim
anywhere on this card that `IG_USERNAME`/`IG_PASSWORD` must also be set. This
supports, but does not independently resolve, finding 1.

### B. Anthropic "Test" button and compat mode (finding 2)

#### TC-SET-B1: Test the currently-configured Anthropic key
Steps:
1. Go to `/settings#api-keys`.
2. Under the "LLM" group, read the Anthropic API key row's badge and source label.
3. Click "Test".
4. Read the resulting toast.
Expected: the badge should read "Configured" with a source label (this
environment's db has an `ANTHROPIC_API_KEY` row per a read-only check, so expect
"set here," not "from .env.local"). Note both possible Test outcomes as informative,
per finding 2, not as pass/fail on the finding itself: a success toast proves the
local proxy at `LLM_BASE_URL` accepted a `count_tokens` call, not that
`api.anthropic.com` validated this exact key; a failure toast proves the opposite
direction is also live, that the proxy may not implement `count_tokens` even though
real generation calls could still work. Either outcome, confirm the toast wording
itself ("connection OK") does not mention compat mode at all, that omission on
screen is the actual, always-true part of this finding regardless of which way Test
resolves today.

#### TC-SET-B2: Groq key has no Test button at all
Steps:
1. On `/settings#api-keys`, read the Groq API key row.
Expected: no "Test" button renders for Groq (`secrets-section.tsx:126`, the Test
button is conditioned on `status.name === "ANTHROPIC_API_KEY"` specifically), which
confirms the doc comment's claim that Groq is presence-only. Not a bug; included so
a reader does not mistake the missing button for one more instance of finding 2.

### C. Sync section source labels (finding 3)

#### TC-SET-C1: Sync cadence's "read from env" note names a variable that is not set
Steps:
1. Go to `/settings#sync`.
2. Read the "Sync cadence" row's info note under the hint text.
Expected: per finding 3, the note should read "Currently read from
SYNC_INTERVAL_MINUTES. Save below to store an override in the database." even
though `.env.local` (read directly, not through the browser) has no
`SYNC_INTERVAL_MINUTES` line and `app_settings` has no `sync_cadence_minutes` row.
The value shown should be `0`. If the note is absent, or reads differently, this
finding needs revising: check the current source badge logic has not changed.

#### TC-SET-C2: Asset retention's "read from env" note names a variable that is not set
Steps:
1. On `/settings#sync`, read the "Asset retention" row's info note.
Expected: same shape as C1: "Currently read from MEDIA_RETENTION_DAYS..." with a
shown value of `90` days, while no such variable or db row exists. Note this row
also carries the (already-known, not re-reported) `warnNote` saying no reaper reads
it, the two notes stack, one honest (unwired), one misleading (source).

#### TC-SET-C3: Lookback and per-sync cap notes are accurate, for contrast
Steps:
1. On `/settings#sync`, read the "Lookback window" and "Per-sync cap" rows' info
   notes.
Expected: these two should also say "Currently read from LOOKBACK_DAYS" and
"...MAX_ITEMS_PER_SYNC," and in this case the notes are accurate: `.env.local` really
does set `LOOKBACK_DAYS=30` and `MAX_ITEMS_PER_SYNC=200`. Confirms finding 3 is
about two specific rows, not the whole section: the mechanism is identical for all
four, only the current environment happens to make two of them true and two of them
false.

### D. Service token source and Regenerate (finding 4)

#### TC-SET-D1: Service token's current source is env, not db
Steps:
1. Go to `/settings#api-keys`, "Instagram sidecar" group.
2. Read the Service token row's badge and source label.
Expected: "Configured" / "from .env.local" (source `"env"`), per the read-only db
check in finding 4 (no `IG_SERVICE_TOKEN` row in `data/crowsnest.db`'s `secrets`
table). Do not click Regenerate; this case only confirms the precondition finding 4
describes is live right now.

#### TC-SET-D2: No warning copy distinguishes an env-sourced token from a db-sourced one
Steps:
1. On the same row, read every visible line of text (row label, badge, source label,
   button text). Do not click Regenerate.
Expected: the only text is the label, the badge, "from .env.local," and a bare
"Regenerate" button, nothing on screen says regenerating an env-sourced token can
desync an already-running sidecar started with the old value. Confirms the "no
warning" half of finding 4 by simple absence.

#### TC-SET-D3: Sidecar control shows Running, consistent with the token being live
Steps:
1. Go to `/settings#instagram` and read the "Sidecar: Running/Not running" badge at
   the top of the section, above the connection panel.
Expected: "Running" (green), consistent with the live `crowsnest_ig` process
confirmed via `ps` outside the browser. This is a baseline consistency check, not
itself a bug; it establishes that Regenerate would be acting on a genuinely live
process, making finding 4's risk real right now, not hypothetical.

### E. Credentials badge vs sidecar reality (finding 5)

#### TC-SET-E1: IG_USERNAME / IG_PASSWORD show Configured, sourced from env
Steps:
1. On `/settings#api-keys`, "Instagram sidecar" group, read the Username and
   Password rows.
Expected: both "Configured" / "from .env.local." Needs fixture beyond this: to
actually observe finding 5's divergence would require changing one of these values
through Settings without restarting the already-running sidecar, which is a write
and out of scope here. This case only establishes the current, honest baseline the
finding is reasoning about.

### F. Local binaries (finding 6)

#### TC-SET-F1: yt-dlp shows available, resolved off PATH with no override configured
Steps:
1. Go to `/settings#local-binaries`.
2. Read the yt-dlp row.
Expected: green check, no reason text (available). `YTDLP_BIN_PATH` is unset in
`.env.local`, and `yt-dlp` resolves on `PATH` in this dev environment (confirmed via
`command -v` outside the browser). Confirms the baseline finding 6 needs a fixture
to expose; the generic-message problem cannot show up while resolution succeeds.

#### TC-SET-F2: whisper-cli shows unavailable with a specific, path-naming reason
Steps:
1. On `/settings#local-binaries`, read the whisper-cli row.
Expected: amber/not-available icon, with a reason mentioning `whisper-cli` and
`PATH` specifically (per `whispercpp.ts:31-34`), since `whisper-cli` itself does not
resolve on `PATH` in this environment even though the model file is present at
`~/.cache/whisper/ggml-large-v3-turbo.bin` (confirmed outside the browser). If the
reason instead mentions a missing model file, the local `command -v whisper-cli`
check that grounded this expectation is stale and the case should be re-run.

### G. Settings nav anchors (checked, not a bug)

#### TC-SET-G1: Every nav item scrolls to a real section
Steps:
1. Go to `/settings`.
2. Click each of the nine left-nav items in order: Niche profile, Instagram, Graph
   API, API keys, Local binaries, Scoring, Feed defaults, Sync, Onboarding.
Expected: each click scrolls to a section whose visible heading matches the nav
label. Per a direct read of `SETTINGS_NAV_ITEMS` in `page.tsx:23-33` against the
nine `id=` attributes on the section wrapper `div`s (`page.tsx:86-144`), all nine
ids match exactly; this case is expected to pass on every item, included as a
verification case since the brief specifically asked to check for a dangling
anchor, and the code read found none.

#### TC-SET-G2: A direct deep link highlights the right nav item before any scrolling
Steps:
1. Go directly to `/settings#scoring` (typed URL, not a click from `/settings`).
Expected: per `settings-nav.tsx:35-39`, the nav's initial active item is seeded from
`window.location.hash` on first render, so "Scoring" should already be highlighted
in the left nav even before the `IntersectionObserver` fires. Confirms the deep-link
behavior the component's own doc comment claims.

### H. Scoring and Onboarding confirm dialogs, opened but not confirmed

#### TC-SET-H1: Scoring's Save is disabled until a field actually changes
Steps:
1. Go to `/settings#scoring`.
2. Without changing anything, read whether "Save (rescores every post)" is enabled
   or disabled.
Expected: disabled. Current db values (`score_baseline_method=median`,
`score_baseline_window=last12Posts`, `score_min_usable_posts=5`,
`score_min_views_floor=0`, confirmed via a read-only query) match `initial`, so
`dirty` (`scoring-section.tsx:52-56`) is `false` on load.

#### TC-SET-H2: Scoring's confirm dialog states the rescore consequence, then Cancel
Steps:
1. Change "Minimum usable posts" from 5 to 6 (a local, unsaved edit; do not click
   Save's confirm).
2. Click "Save (rescores every post)" to open the dialog.
3. Read the dialog body.
4. Click Cancel.
Expected: dialog text states every stored score gets recomputed in one transaction,
all-or-nothing on failure (`scoring-section.tsx:117-122`). After Cancel, the dialog
closes and no request was sent; confirm the Save button is still enabled (field
still shows 6, still dirty) since Cancel only closes the dialog, it does not revert
the input.

#### TC-SET-H3: Onboarding's confirm dialog states what Replay does and does not touch, then Cancel
Steps:
1. Go to `/settings#onboarding`.
2. Click "Replay first run" to open the dialog.
3. Read the dialog body.
4. Click Cancel.
Expected: dialog text states channels, niche profile, and the Instagram session all
stay as they are (`onboarding-section.tsx:57-60`). After Cancel, still on
`/settings`, `firstRunCompleted` unchanged. Do not click the dialog's own "Replay
first run" confirm button; that is the write this plan excludes.

### I. Graph API vs API keys cross-check

#### TC-SET-I1: Graph API section and API keys' Graph group agree on "not connected" today
Steps:
1. Go to `/settings#graph-api`, read the state badge.
2. Go to `/settings#api-keys`, "Graph API" group, read both rows (Graph token,
   Graph user ID).
Expected: Graph API section shows "Not connected" (`state: "not_configured"`,
`graph-section.tsx:26-33`), and both API keys rows show "Not set," since
`IG_GRAPH_TOKEN`/`IG_GRAPH_USER_ID` are absent from both `.env.local` and the
db (confirmed by direct read of both). This is the well-behaved case, included as a
baseline contrast to findings 4 and 5, where a "Configured" secrets-panel badge and
a live connection state can diverge; here, with nothing configured at all, they
correctly agree.

#### TC-SET-I2: Graph section's Recheck is a live, read-only network call
Steps:
1. On `/settings#graph-api`, click "Recheck."
2. Read the updated "last checked" timestamp.
Expected: timestamp updates to the current time; state stays "Not connected" (no
token to check). `checkGraphTokenAction` performs a real GET against the Graph API
each time (`graph/client.ts:432-434`), so this is a genuine live check, not a cached
label; safe to click since it changes no stored data.

## Verdict

Six candidates, all grounded in file:line, three demonstrable in this exact dev
environment without any forbidden click (compat-mode Test, the two misleading Sync
source notes, the live-sidecar-plus-env-sourced-token precondition for Regenerate),
three needing a fixture this dev environment does not currently have (sessionid-only
login, a post-boot credential change, a bad `YTDLP_BIN_PATH`). The most severe is
finding 1: a supported, recommended login method (sessionid-only) can render as the
single most alarming disconnected state the panel has, because `viewStateOf` checks
password-credential presence before login state and never reconsiders once it
returns early.

Everything in this plan is read-only. No secret was set or cleared, no sidecar was
started or stopped, no token was regenerated, no dialog's destructive action was
confirmed, and no session ID was submitted while producing this document.

## Verification, code + DB, 2026-08-01

Read-only second pass: re-read every file cited above, re-ran the `.env.local` grep
(names only, no values printed) and the `data/crowsnest.db` queries, and checked the
live sidecar process via `ps`. No browser was opened, no code was edited, nothing was
written to the db. All six line citations in the six findings above were checked
against the current file contents and are accurate (one is off by one line: the
`canLogin` doc comment in `src/server/ig/client.ts` runs 295-298, not 296-298 as
written; the content matches exactly either way).

**1. IG state-order (`credentialsConfigured` before `loggedIn`), CONFIRMED.**
`src/components/settings/instagram-section.tsx:66-67` still reads, unconditionally:
`if (!statusResult.status.credentialsConfigured) return "no_credentials"; if
(!statusResult.status.loggedIn) return "logged_out";` (the second line is dead for
any status where the first is false). `credentialsConfigured` is wired to
`health.canLogin` at `src/server/actions/ig-actions.ts:118`, and `canLogin`'s doc
comment at `src/server/ig/client.ts:295-298` defines it as "Both IG_USERNAME and
IG_PASSWORD are configured on the sidecar," nothing about a session cookie. The
ordering bug is unconditional code, true regardless of environment. Confirmed masked
in this exact dev environment: `.env.local` sets both `IG_USERNAME` and `IG_PASSWORD`
(grepped, names only), so `canLogin`/`credentialsConfigured` is `true` here and
`no_credentials` cannot render live without a sessionid-only sidecar fixture, exactly
as the original write-up says.

**2. Anthropic "Test" validates the proxy, not api.anthropic.com, CONFIRMED.**
`src/components/settings/secrets-section.tsx:107-113` (`runTest`) calls
`testAnthropicKeyAction`, `src/server/actions/settings-actions.ts:96-105`, which calls
`getLlm().ping()`. `isCompatMode()` at `src/server/llm/client.ts:219-221` is
`Boolean(process.env.LLM_BASE_URL)`; `getLlm()` at `client.ts:232-241` returns a
`CompatLlmClient` whenever that's true, built with `baseURL:
process.env.LLM_BASE_URL`. `CompatLlmClient.ping()` (`client.ts:183-188`) calls
`messages.countTokens(...)` through that base URL. Confirmed live: `.env.local`
sets `LLM_BASE_URL` (grepped, name only; matches this project's known 9router LLM
setup pointing at `http://localhost:20128`). Compat mode is active right now, so a
"connection OK" toast from this button currently proves the local proxy accepted the
call, not that the real Anthropic API validated the stored key. Toast copy at
`secrets-section.tsx:110-111` is the single string `` `${meta.label}: connection
OK` `` either way, no compat-mode indicator anywhere in this file.

**3. Sync section's env-source note names vars that were never set, CONFIRMED.**
`src/server/settings/index.ts:158-163` (`ENV_FALLBACK`) maps `syncCadenceMinutes` to
`config.SYNC_INTERVAL_MINUTES` and `mediaRetentionDays` to `config.MEDIA_RETENTION_DAYS`
with no check of whether the OS env var was actually present.
`src/server/config.ts:46,60` gives both a schema default (`intWithDefault(0, ...)` and
`intWithDefault(90, ...)`) that applies whether or not the var is set. `resolve()` at
`settings/index.ts:203-214` tags the result `source: "env"` whenever an `ENV_FALLBACK`
entry exists and no db row does, regardless of that distinction.
`src/components/settings/sync-section.tsx:201-205` (`envNote`) then renders
"Currently read from `SYNC_INTERVAL_MINUTES`..." (or `MEDIA_RETENTION_DAYS`) for any
key whose source is `"env"`. Confirmed live: `.env.local` (grepped, names only) has no
`SYNC_INTERVAL_MINUTES` and no `MEDIA_RETENTION_DAYS` line; `SELECT * FROM
app_settings` on `data/crowsnest.db` returns 7 rows (`niche_profile`,
`recently_viewed`, `niche_keywords`, `score_baseline_method`, `score_baseline_window`,
`score_min_usable_posts`, `score_min_views_floor`), no `sync_cadence_minutes` or
`media_retention_days` row. Both fields fall through to `config.ts`'s hardcoded
default and still get labeled `"env"` and shown the var-naming note. By contrast
`LOOKBACK_DAYS=30` and `MAX_ITEMS_PER_SYNC=200` genuinely are present in `.env.local`
(grepped, names only, values present), so the same mechanism is accurate for those two
rows, matching the doc's own contrast case (TC-SET-C3).

**4. Service-token Regenerate can desync a live sidecar, CONFIRMED (precondition
live now; the click itself was not performed, per the read-only/no-DB-write
instruction).** `secrets-section.tsx:131-134` renders the "Regenerate" button
unconditionally whenever `isServiceToken` (`status.name === "IG_SERVICE_TOKEN"`),
independent of `status.source`. `regenerateServiceTokenAction`
(`src/server/actions/secrets-actions.ts:63-67`) unconditionally overwrites the db row.
`src/server/sidecar/control.ts:20-32` (`childEnv`) reads `getSecret("IG_SERVICE_TOKEN")`
(and username/password) only at the moment `startSidecar()` spawns the child;
`getSecret` (`src/server/secrets/store.ts:37-42`) is db-first, env-fallback, so a
regenerate after boot only changes what this Node process sees, not the sidecar's own
environment. Confirmed live in this exact environment: `SELECT name FROM secrets`
returns only `ANTHROPIC_API_KEY` and `IG_SESSIONID`, no `IG_SERVICE_TOKEN` row, so
the token's current source is `"env"` (from `.env.local`'s `IG_SERVICE_TOKEN` line,
confirmed present by name via grep). `data/sidecar.pid` contains `84857`; `ps -p 84857`
shows a live `uv run python -m crowsnest_ig` process, with its `crowsnest_ig` child at
pid 84862 also present in `ps aux`. The precondition the finding depends on (env-sourced
token, sidecar already running under it) is real right now, confirmed without clicking
Regenerate.

**5. "Configured" badge doesn't reflect what the running sidecar actually has,
CONFIRMED as a code-level mechanism; live divergence not observable without a write,
so not checked further here.** `sidecar/control.ts:20-32` confirms `childEnv()` reads
`IG_USERNAME`/`IG_PASSWORD` from the store only at `startSidecar()` call time, matching
the finding exactly. `secretStatus()` (`secrets/store.ts:58-64`) independently reports
"Configured" from the store's current value with no cross-check against the live
process. This is a real gap in the code, not a guess. Producing the actual divergence
(edit a credential in Settings without restarting the sidecar) is a write, out of scope
for this read-only pass, same conclusion the original doc reached ("needs fixture"),
just re-confirmed against current code rather than assumed.

**6. yt-dlp's "not found" reason is generic; whisper's is specific, CONFIRMED, not
observable in this environment right now.** `src/app/(shell)/settings/page.tsx:66-69`
still hardcodes `"not found on PATH"` for yt-dlp with no mention of a configured
`YTDLP_BIN_PATH`, sourced from `detectBinary(process.env.YTDLP_BIN_PATH ?? "yt-dlp")`
(`src/server/lib/exec.ts:33-43`, confirmed generic message, no path echoed anywhere in
that function). `whisperAvailability()` (`src/server/transcribe/whispercpp.ts:23-44`)
by contrast returns `"whisper-cli not found on PATH..."` or a reason that interpolates
the exact model path when the binary resolves but the model file is missing, both
specific. Confirmed live: `.env.local` has no `YTDLP_BIN_PATH` line (grepped, name
only), `command -v yt-dlp` resolves to a real binary on this machine's `PATH`, so
`ytdlpPath !== null` and the misleading generic-reason branch never renders today. Also
confirmed as a side note: `command -v whisper-cli` exits 1 (not found) while
`~/.cache/whisper/ggml-large-v3-turbo.bin` exists on disk (1.6 GB), so the whisper row
is expected to show its "not found on PATH" reason (not the missing-model reason) in
this environment right now, consistent with TC-SET-F2's expectation and its stale-check
warning.

### Summary

Six of six bug candidates confirmed from code plus config/DB state; none rejected,
none required a browser. Findings 1, 2, and 3 are demonstrable in this exact
environment already (compat-mode Test, both misleading Sync notes). Findings 4 and 6
have their live preconditions confirmed (env-sourced token plus a running sidecar;
`YTDLP_BIN_PATH` genuinely unset) but the on-screen symptom itself still needs a
fixture this environment does not have (clicking Regenerate is destructive and stays
off-limits; a bad `YTDLP_BIN_PATH` was not set here). Finding 5's mechanism is
confirmed in code; observing the actual badge divergence needs a credential write,
also out of scope for a read-only pass.
