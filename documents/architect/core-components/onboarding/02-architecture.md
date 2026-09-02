# onboarding: architecture

Onboarding is two halves that never share code: a terminal half in the CLI (`kai kit
init`) and an in-app half at the `/first-run` route, joined only by the `.env.local` the
first writes and the `app_settings.first_run_completed` flag the second sets. A route
guard stands between a fresh install and the rest of the app.

## Key files

- `src/cli/kai.ts`: the CLI. `cmdKitInit` (the `kai kit init` command) writes `.env.local`
  and prompts for the Instagram account and the optional Anthropic key; `ask` is the one
  shared prompt helper, and its `secret: true` path is where both known onboarding bugs
  live.
- `src/app/first-run/page.tsx`: the `/first-run` route, a top-level route deliberately
  outside `(shell)` (no sidebar, no topbar). `force-dynamic`; reads live settings and
  Instagram status on every visit; redirects a finished install back to `/`.
- `src/components/first-run/onboarding-flow.tsx`: the five-screen client flow. Holds the
  current step in memory (`useState`), renders each step, and owns the persistent "Skip
  setup for now" control.
- `src/components/first-run/onboarding-view.ts`: pure step-ordering logic (the step list,
  `stepNavState`, `canVerifyHandles`), kept out of the JSX so node-only vitest can cover
  it. `onboarding-view.test.ts` is its test.
- `src/components/first-run/welcome-step.tsx`, `focus-step.tsx`, `connect-step.tsx`,
  `sources-step.tsx`, `first-sync-step.tsx`: the five screens (welcome plus four numbered
  steps `01 FOCUS`, `02 INSTAGRAM`, `03 CHANNELS`, `04 FIRST SYNC`).
- `src/server/queries/first-run-gate.ts`: the route guard. `shouldRedirectToFirstRun` is
  the pure rule; `getFirstRunGate` is the async reader that runs it against the database.
- `src/app/(shell)/layout.tsx`: the caller of the gate. Redirects a fresh install to
  `/first-run` before any other shell query runs.
- `src/components/settings/onboarding-section.tsx`: the "Replay first run" Settings
  control, which clears `first_run_completed` so the flow can be seen again.

## Data flow

**Terminal half — `kai kit init`.** `cmdKitInit` (`src/cli/kai.ts`) requires a cached
entitlement first (`readEntitlement`, from the earlier `kai login`). It copies `.env.local`
from `.env.example` (or edits it in place if present), prompts for `IG_USERNAME` then
`IG_PASSWORD` (the latter through `ask(..., { secret: true })`), generates
`IG_SERVICE_TOKEN` if it is still the `change-me` placeholder, prompts for an optional
`ANTHROPIC_API_KEY` (also `secret: true`), and asks for `VAULT_PATH` (default
`~/.crowsnest/vault`), creating that directory. It writes `.env.local` at mode `0600` and
`chmod`s it again (the file holds the Instagram password), then runs the database
migrations and bootstrap through `node`/`tsx` directly and finally hands off to `kai up`.
This half is shared with the [Kit](../kit/01-concept-brief.md); see
[kit/02-architecture.md](../kit/02-architecture.md) for the install and `up` steps around
it.

**The gate.** `src/app/(shell)/layout.tsx` calls `getFirstRunGate` before any other read.
The rule (`shouldRedirectToFirstRun`) is compound on purpose:
`!firstRunCompleted && !hasChannels`. A database that already has a `channels` row — a
seeded dev database, or one that predates the flag — is treated as done even with the flag
unset, so a real production database is never routed back into the wizard. Once
`first_run_completed` is true it decides alone and stays true even if every channel is
later removed. On a match the layout `redirect`s to `/first-run` and the shell never
renders.

**In-app half — `/first-run`.** `page.tsx` is the other half of that gate: it reads
`getSettings()`, and if `firstRunCompleted` is already true it `redirect`s straight to `/`
rather than re-running answered steps. Otherwise it reads the niche settings and the live
Instagram status (`getIgStatusAction`) in parallel and renders `OnboardingFlow`. The five
screens each write through an existing server action, not a new one:

- **focus** → `saveNicheSettingsAction` (the same `niche_profile` key Settings' Niche
  Profile section writes).
- **connect** → `igLoginAction` and its `igChallengeChooseAction` /
  `igChallengeCodeAction` / `igTwoFactorAction` branches, read back through
  `getIgStatusAction` — the exact actions Settings' Instagram section uses.
- **sources** → `addChannelAction` (idempotent per handle), the same action the Channels
  page's add-channel dialog uses; nothing becomes a `channels` row until Continue.
- **sync** → `useSyncProgress` / `<SyncProgressPanel>`, the same sync surface the Channels
  page and Settings show, then `updateAppSettingsAction({ firstRunCompleted: true })`.

**Finishing.** Both the sync step's "Open Crowsnest" and the aside's "Skip setup for now"
write `first_run_completed` through the generic `updateAppSettingsAction` and then
`router.push("/")`. A plain link would bounce straight back through the gate on the
zero-channel install this screen exists for, so the flag write is what actually ends first
run. "Skip" is deliberately available throughout, because the sources step's Continue only
lights up once a real handle is added, and someone without one otherwise has nowhere to go.

## Decisions

- **Two independent halves, joined only by `.env.local` and one flag.** The CLI never
  imports the app and the app never shells the CLI. The terminal half exists because the
  Instagram sidecar needs credentials on disk before the server can even reach it; the
  in-app half exists to get an empty install to a tracked channel and a first sync.
- **`/first-run` is its own top-level route, not a `(shell)` child.** The shell's sidebar,
  topbar, and failure strip have nothing to orient here, and the shell's own gate would
  otherwise have to special-case its way around itself. The flow is a full-bleed two-column
  screen instead.
- **The gate is compound (`!firstRunCompleted && !hasChannels`), not just the flag.** This
  is the whole reason the gate exists: a real database with channels must never be routed
  back into a wizard. See `first-run-gate.ts`'s module doc.
- **Step state lives in memory, not the URL.** Nothing about "what step am I on" needs to
  survive a reload independently of what each step already persisted server-side; a reload
  mid-flow re-lands on welcome and re-asks a question or two whose answers are already
  saved.
- **Every step reuses an existing server action.** No step introduces its own action; the
  connect step in particular shares Settings' Instagram surface rather than a copy, so
  re-establishing a session later goes through the same code.
- **The connect step shows only the one real fact it has, the connected handle.** Follower
  and post counts are not shown because `getIgStatusAction` carries no such fields; per the
  no-fabricated-data rule a capability the app lacks does not appear in the UI.

## Known defects

Both filed against a real onboarding pass ([evidence/10-onboarding-bugs.md](../../../../evidence/10-onboarding-bugs.md),
tracked as ONB-1 / ONB-2 in [05-backlog-to-enhance.md](05-backlog-to-enhance.md)); both are
in the CLI prompt code, not the app:

- **ONB-1 (blocker): `kai kit init` saves `IG_PASSWORD` empty on a real TTY.** The masked
  `IG_PASSWORD` read (`ask(..., { secret: true })`, `src/cli/kai.ts`) returns an empty
  value, so `.env.local` gets `IG_PASSWORD=` (length 0). `IG_USERNAME`, read just before by
  the non-secret path, saves fine. With a username but no password the Instagram sidecar
  refuses to start ("IG_USERNAME and IG_PASSWORD must be set together", exit 78
  `EX_CONFIG`), launchd's keepalive crash-loops it, and Instagram sync is dead for the
  buyer with no onboarding-time warning. Root cause is `ask`'s `secret` path, which hides
  the terminal echo by overriding `readline`'s `_writeToOutput`; on a real TTY the value
  read back is empty.
- **ONB-2 (medium): `kai kit init` echoes `ANTHROPIC_API_KEY` in plaintext.** The same
  `ask({ secret: true })` path fails to suppress the echo for the key prompt on this TTY,
  so the key lands in terminal scrollback. Not a functional blocker, but a security/UX
  defect.

## Open, not verified end to end

- No Graph API path exists in the app today. Per the coldstart design work the panel for
  the user's own channel's Graph token was proposed but never built; the burner Instagram
  identity read by the sidecar and any future Graph token must never share code or an
  environment-variable prefix. See [01-concept-brief.md](01-concept-brief.md).
- A live Instagram connect through the `/first-run` connect step against real credentials
  has not been proven end to end while ONB-1 leaves the sidecar down on a real buyer
  install; the connect step's `IG_SERVICE_DOWN` branch is what a buyer hitting ONB-1
  actually sees.
- The dashboard redesign (moving Instagram login and key entry into the dashboard with live
  validation) is tracked as ENH-1 in [05-backlog-to-enhance.md](05-backlog-to-enhance.md)
  and is not built.
