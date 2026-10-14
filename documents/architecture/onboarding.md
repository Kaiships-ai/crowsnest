# Onboarding

Onboarding takes an empty install to a dashboard with a tracked channel and a first sync underway, once. It has two halves that share no code. The terminal half is `kai kit init` in `src/cli/kai.ts` (`cmdKitInit`). The in-app half is a five screen flow at `/first-run` (welcome, then `01 FOCUS`, `02 INSTAGRAM`, `03 CHANNELS`, `04 FIRST SYNC`), outside the app shell. A route guard sends a fresh install there before any shell page renders. The same part owns the dashboard credential path (live-validated Instagram login, the secrets panel) and the LLM key and route resolution that make AI features work with a key alone.

## Data it holds

Onboarding owns no table of its own; schemas are in `src/server/db/schema.ts`.

- `app_settings`: `first_run_completed` (the flag the gate reads), `niche_profile` and `niche_keywords` (written by the focus step, read by Settings and `services/remix.ts`).
- `secrets`: `name`, `value`, `updated_at`, holding the eight `MANAGED_SECRETS` (`IG_SERVICE_TOKEN`, `IG_USERNAME`, `IG_PASSWORD`, `IG_SESSIONID`, `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`). A db value wins over the env var of the same name. Plaintext in sqlite, never returned to the browser or logged.
- `channels` rows, written through the shared `addChannelAction`, and a `sync_jobs` row from the first sync. Both belong to ig-sync.
- `.env.local`, the only artifact the two halves share. `kai kit init` writes it at mode `0600` (it can hold the Instagram password).

## Boundaries

- Owns: the first run gate (`src/server/queries/first-run-gate.ts`), the `/first-run` route and flow (`src/app/first-run/`, `src/components/first-run/`), `cmdKitInit` and the shared prompt helpers in `src/cli/kai.ts`, the secrets store and its Settings panel, and the LLM client with its key and proxy resolution (`src/server/llm/client.ts`).
- Called by: `src/app/(shell)/layout.tsx` (the gate, and the "Finish setup" checklist item), Settings' Onboarding section (replay), Settings' Instagram and API keys panels, every AI feature through `getLlm()`, and the packaged launchd job.
- Calls: the Instagram sidecar (owned by ig-sync) for login and the first sync, always through server actions another part owns (`igLoginAction`, `igLoginWithCredentialsAction`, `saveNicheSettingsAction`, `addChannelAction`, `startSyncAction`, `updateAppSettingsAction`), the shared `useSyncProgress` and `SyncProgressPanel`, and the local 9router proxy through `router-control.ts`. Instagram is never reached directly.

## Invariants

- The burner Instagram login (sidecar session) and the Graph token never share code or an env prefix. No Graph path exists in onboarding.
- Skip is on every step because the sources step only continues once a real handle is added, and someone without one must still be able to leave. `/first-run` sits outside the app shell so a fresh install shows no sidebar or topbar over an empty database.
- The gate is compound: `!firstRunCompleted && !hasChannels` (`shouldRedirectToFirstRun`). A database that already has a channel is never sent back into the wizard, and once the flag is true it decides alone, even if every channel is later removed. `/first-run` itself redirects to `/` when the flag is set.
- `first_run_completed` ends first run. Both "Open Crowsnest" and "Skip setup for now" write it through `updateAppSettingsAction`, because a plain link would bounce back through the gate on a zero channel install. Settings' "Replay first run" clears it without deleting any data.
- Step state is in memory (`useState`), not the URL. Each step persists through an existing action as it is passed, so a reload loses nothing saved. Onboarding adds no action of its own.
- `ONBOARDING_STEPS` in `onboarding-view.ts` is the single step list; the welcome copy reads its length.
- The sources step validates each handle with `normalizeHandle` (`src/lib/handle.ts`) at add time, so a malformed token never joins the pending list. A well formed handle the sidecar cannot verify is still added and checked on the first sync.
- The first sync step ignores `useSyncProgress()` until it has launched a run itself (`started` is lifted to `OnboardingFlow`), because that hook reports the latest `sync_jobs` row anywhere. "Open Crowsnest" appears on any terminal status, including failed.
- The connect step shows only the connected handle, never counts, because `getIgStatusAction` carries no such fields.
- `kai kit init` refuses to run without a cached entitlement from `kai login`. It edits an existing `.env.local` in place (`setEnv`), asks for `IG_PASSWORD` only when a username was given (`checkPairedIgCreds`), generates `IG_SERVICE_TOKEN` only while it is the `change-me` placeholder, runs `migrate.ts` and `bootstrap.ts`, then `cmdUp` and `cmdMcp`.
- Secret prompts never echo: `ask(..., { secret: true })` reads bytes in raw mode through `readSecretLine`. Regressing this brings back an empty saved `IG_PASSWORD`, which leaves the sidecar unable to start.
- Username and password login validates before it persists. `igLoginWithCredentialsAction` calls the sidecar login first and writes `IG_USERNAME` and `IG_PASSWORD` only on `"ok"`; a two factor or challenge result is returned unsaved and persisted when the follow-up action succeeds. The session-token path (`igLoginBySessionAction`) persists first, a deliberate exception for a value that expires. The plain secrets rows for the Instagram pair still save without a login check.
- Saved credentials reach a running sidecar only when its process starts, except the credentials form, which logs in against the live sidecar. The packaged path injects them in `src/cli/service-darwin.ts` (`igEnv`) into the plist `EnvironmentVariables`, omitting unset values. The dev path does the same in `src/server/sidecar/control.ts` (`childEnv`). Every plist value passes through `xmlEscape`, so a password with `&` or `<` cannot make `launchctl bootstrap` reject the file. `pinDbPathEnv()` runs at module load so the CLI and the server agree on one `CROWSNEST_DB_PATH`.
- `getLlm()` throws `NoApiKeyError` with no `ANTHROPIC_API_KEY`. With a key and `LLM_BASE_URL` set it uses the proxy client only while `routerReachable()` answers, else it calls Anthropic directly. `.env.example` ships `LLM_BASE_URL=http://localhost:20128`, so every install has an address configured by default.
- `isRoutedThroughProxy()` (presence plus reachability) is the one question both `getLlm()` and the dashboard dependency badge ask, so the badge cannot disagree with real routing. `isCompatMode()` is only "an address is set".
- The client is cached. Reachability is checked once per cache lifetime; `resetLlmClient()` runs on every secret save, so a new key takes effect with no restart, but a proxy that comes back mid-session is picked up only after a save or restart.
- Settings' "Test" for the Anthropic key is a separate manual `count_tokens` call (`testAnthropicKeyAction`), not a gate on save.
- `routerBin()` resolves the 9router binary from `ROUTER_BIN`, then `which 9router`, then a Homebrew path; Start/Stop never installs it.

## Where to look

- `src/server/queries/first-run-gate.ts` and `src/app/(shell)/layout.tsx` (the gate)
- `src/components/first-run/onboarding-flow.tsx` and `onboarding-view.ts` (flow and step list)
- `src/cli/kai.ts` (`cmdKitInit`, `ask`, `readSecretLine`, `checkPairedIgCreds`)
- `src/server/actions/ig-actions.ts` (login actions) and `src/server/secrets/store.ts`
- `src/cli/service-darwin.ts` and `src/server/sidecar/control.ts` (credential delivery)
- `src/server/llm/client.ts` and `src/server/llm/router-control.ts`
- `src/components/settings/onboarding-section.tsx`, `instagram-section.tsx`, `secrets-section.tsx`
