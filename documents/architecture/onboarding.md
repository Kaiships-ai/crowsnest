# Onboarding

Onboarding takes an empty install to a tracked channel and a first sync underway, once. The terminal half is `kai kit init` in `src/kai-cli/kai.ts` (`cmdKitInit`). The web app's in-app half, the `/first-run` flow and its route guard, is retired with the web app; a Lead Studio board replaces it. What stays in the server is the first run gate rule and the credential path (live-validated Instagram login, the secrets store).

## Data it holds

Onboarding owns no table of its own; schemas are in `src/server/db/schema.ts`.

- `app_settings`: `first_run_completed` (the flag the gate reads), `niche_profile` and `niche_keywords` (read by `services/remix.ts`).
- The six managed secrets (`IG_SERVICE_TOKEN`, `IG_USERNAME`, `IG_PASSWORD`, `IG_SESSIONID`, `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`), declared by the connector manifests and sealed by the Keychain ([connectors](connectors.md)). A stored value wins over the env var of the same name. Never returned to a client or logged.
- `channels` rows, written through the shared `addChannelAction`, and a `sync_jobs` row from the first sync. Both belong to ig-sync.
- `.env.local`, the only artifact the two halves share. `kai kit init` writes it at mode `0600` (it can hold the Instagram password).

## Boundaries

- Owns: the first run gate (`src/server/queries/first-run-gate.ts`), `cmdKitInit` and the shared prompt helpers in `src/kai-cli/kai.ts`. The secrets themselves belong to [connectors](connectors.md).
- Called by: the packaged launchd job. No screen calls the gate or the login actions while the Lead Studio boards are not built.
- Calls: the Instagram sidecar (owned by ig-sync) for login and the first sync, always through server actions another part owns (`igLoginAction`, `igLoginWithCredentialsAction`, `saveNicheSettingsAction`, `addChannelAction`, `startSyncAction`, `updateAppSettingsAction`). Instagram is never reached directly.

## Invariants

- The burner Instagram login (sidecar session) and the Graph token never share code or an env prefix. No Graph path exists in onboarding.
- The gate is compound: `!firstRunCompleted && !hasChannels` (`shouldRedirectToFirstRun`). A database that already has a channel never needs first run, and once the flag is true it decides alone, even if every channel is later removed.
- `first_run_completed` ends first run. It is written through `updateAppSettingsAction`, and clearing it deletes no data.
- A handle is validated with `normalizeHandle` (`src/lib/handle.ts`) before it is added. A well formed handle the sidecar cannot verify is still added and checked on the first sync.
- `kai kit init` refuses to run without a cached entitlement from `kai login`. It edits an existing `.env.local` in place (`setEnv`), asks for `IG_PASSWORD` only when a username was given (`checkPairedIgCreds`), generates `IG_SERVICE_TOKEN` only while it is the `change-me` placeholder, runs `migrate.ts` and `bootstrap.ts`, then `cmdUp` and `cmdMcp`.
- Secret prompts never echo: `ask(..., { secret: true })` reads bytes in raw mode through `readSecretLine`. Regressing this brings back an empty saved `IG_PASSWORD`, which leaves the sidecar unable to start.
- Username and password login validates before it persists. `igLoginWithCredentialsAction` calls the sidecar login first and writes `IG_USERNAME` and `IG_PASSWORD` only on `"ok"`; a two factor or challenge result is returned unsaved and persisted when the follow-up action succeeds. The session-token path (`igLoginBySessionAction`) persists first, a deliberate exception for a value that expires. The plain secrets rows for the Instagram pair still save without a login check.
- Saved credentials reach a running sidecar only when its process starts, except `igLoginWithCredentialsAction`, which logs in against the live sidecar. The packaged path injects them in `src/kai-cli/service-darwin.ts` (`igEnv`) into the plist `EnvironmentVariables`, omitting unset values. The dev path does the same in `src/server/sidecar/control.ts` (`childEnv`). Every plist value passes through `xmlEscape`, so a password with `&` or `<` cannot make `launchctl bootstrap` reject the file. `pinDbPathEnv()` runs at module load so the CLI and the server agree on one `CROWSNEST_DB_PATH`.
- `kai kit init` asks for no model key. The app makes no model call of its own.

## Where to look

- `src/server/queries/first-run-gate.ts` (the gate)
- `src/kai-cli/kai.ts` (`cmdKitInit`, `ask`, `readSecretLine`, `checkPairedIgCreds`)
- `src/server/actions/ig-actions.ts` (login actions) and `src/server/actions/secrets-actions.ts`
- `src/kai-cli/service-darwin.ts` and `src/server/sidecar/control.ts` (credential delivery)
