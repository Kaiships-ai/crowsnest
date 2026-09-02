# Settings-managed secrets, sidecar control, and session-token login

Date: 2026-07-31
Status: approved, ready for implementation plan

## Problem

Every secret the app needs lives in `.env.local` and is read once at boot. Changing one means editing a file and restarting the dev server. Three concrete pains:

1. No way to set an API key or Instagram credential from the app. The API keys settings panel only reports present or absent and tells you to edit `.env.local`.
2. The Instagram sidecar is a manual `npm run ig:service` in a second terminal. Nothing in the app starts it.
3. Password login through instagrapi fails for at least one real account (hat.iendata): Instagram answers BadPassword to the private API even though the browser accepts the password. The only thing that works is importing the browser's `sessionid` cookie. The sidecar already has a `/login-by-session` endpoint for this, but no UI reaches it.

The current design also refuses to boot when `IG_SERVICE_TOKEN` is unset (config.ts throws), which is the "app won't run without a key" behavior the owner wants gone.

## Goals

- Set, replace, and clear every secret from the settings page, with the change taking effect at runtime, no restart.
- Auto-generate `IG_SERVICE_TOKEN` so the app always boots and the app-to-sidecar secret matches by construction.
- A Start and Stop button for the sidecar in settings, with live status.
- A session-token login path for Instagram, presented as the recommended one, alongside the existing username/password flow.
- One panel that shows all secrets and their status, so the full key surface is visible in one place.

## Non-goals

- Encrypting secrets at rest. They sit in the local sqlite as plaintext, the same trust level as `.env.local` today. A local single-user app on the owner's machine.
- Managing non-secret config (timeouts, model names, paths). Out of scope.
- Any change to how the sidecar talks to Instagram beyond exposing the existing session-import endpoint.

## Decisions (from the brainstorm)

- Storage is hybrid: a db-backed secrets store read first, `.env.local` as fallback. UI edits win at runtime.
- All eight secrets are UI-managed: `IG_SERVICE_TOKEN`, `IG_USERNAME`, `IG_PASSWORD`, `IG_SESSIONID`, `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`.
- `IG_SERVICE_TOKEN` auto-generates when absent from both db and env. It is never something the owner types.
- The sidecar Start button spawns the real Python process with the stored secrets injected as its environment.
- Session-token login is the recommended Instagram path; password login stays as a fallback.
- A stored secret is never echoed back to the browser. The UI shows Configured or Not set, with Set, Replace, Clear, and a Test where one exists.
- Instagram username and password reach the sidecar only as injected environment when the app spawns it, never in an HTTP request body. The `sessionid` reaches the sidecar through the existing `/login-by-session` call at connect time.

## Architecture

### Secrets store

New table `secrets`:

| column | type | note |
|--------|------|------|
| name | text primary key | the env var name, e.g. `ANTHROPIC_API_KEY` |
| value | text not null | plaintext secret |
| updated_at | text not null | ISO 8601 |

New module `src/server/secrets/store.ts`:

- `getSecret(name: string): string | undefined` reads the db row first, then `process.env[name]`, else undefined. Synchronous (better-sqlite3).
- `setSecret(name, value): void` upserts. Empty or whitespace-only value is rejected (use clear instead).
- `clearSecret(name): void` deletes the db row. Note this does not touch `.env.local`, so a value present in the env still shows through after a clear. The UI must say so.
- `secretStatus(): SecretStatus[]` returns one entry per known secret: `{ name, configured: boolean, source: "db" | "env" | "none" }`. Never returns values.
- `MANAGED_SECRETS: readonly string[]` is the list of eight names above, the single source of truth for the panel.
- `getOrCreateServiceToken(): string` returns `getSecret("IG_SERVICE_TOKEN")` if set, otherwise generates `crypto.randomBytes(32).toString("hex")`, stores it with `setSecret`, and returns it.

Redaction: `secretStatus` and every action return status, not values. No secret value is logged (the logger and its db sink already redact these key names).

### config.ts change

`IG_SERVICE_TOKEN` moves from required to optional in the schema, so a missing token no longer throws at boot. The canonical read for the token becomes `getOrCreateServiceToken()` from the store, not `config.IG_SERVICE_TOKEN`. Everything else in config.ts is unchanged. `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY` were already optional or read directly from `process.env`; those reads move to `getSecret`.

### Consumers routed through the store

Each of these currently reads `process.env` or the boot-time `config` object and must read `getSecret` at call time so a UI edit takes effect live:

- `src/server/llm/client.ts`: `ANTHROPIC_API_KEY` presence and value (`hasApiKey`, the client construction). `CLAUDE_MODEL` and `ANTHROPIC_BASE_URL` are not secrets and stay as they are.
- `src/server/graph/client.ts`: `IG_GRAPH_TOKEN` and `IG_GRAPH_USER_ID` (the `isConfigured` check at line 337 and the credential read at 341 to 344, plus line 435).
- `src/server/transcribe/groq.ts`: `GROQ_API_KEY` (availability and the key read).
- `src/server/ig/client.ts` and the sidecar auth header: `IG_SERVICE_TOKEN` becomes `getOrCreateServiceToken()`.
- `src/app/api/logs/ingest/route.ts`: the token compare reads `getOrCreateServiceToken()` so it matches whatever the sidecar was given.

### Settings: secrets panel

Rebuild the API keys section into a secrets panel listing all eight managed secrets grouped sensibly (LLM: Anthropic, Groq; Instagram sidecar: service token, username, password, sessionid; Graph: token, user id). Each row:

- Status pill: Configured or Not set, plus the source (from `.env.local` or set here) when configured.
- A Set or Replace control that opens a single masked input and calls a server action. A Clear control where a db value exists.
- A Test button only where a real test exists (Anthropic, via the existing `testAnthropicKeyAction`).

New server actions in `src/server/actions/secrets-actions.ts`:

- `setSecretAction(name, value): SimpleResult` (validates `name` is in `MANAGED_SECRETS`).
- `clearSecretAction(name): SimpleResult`.
- `getSecretStatusAction(): SecretStatus[]`.

The service token row is special: it shows Configured (auto-generated) and offers Regenerate rather than a blank Set, since there is always a value.

### Settings: sidecar control

New server actions in `src/server/actions/sidecar-actions.ts`:

- `startSidecarAction(): SimpleResult` spawns the sidecar process and records its pid. It runs the same command `scripts/ig-service.sh` uses (`uv run python -m crowsnest_ig` with cwd `services/ig`), detached, injecting into the child environment: `IG_SERVICE_TOKEN` (from `getOrCreateServiceToken`), `IG_USERNAME`, `IG_PASSWORD`, `IG_PROXY`, `IG_DEVICE_SEED`, and `CROWSNEST_INGEST_URL` (the app's own ingest URL). The pid is written to `data/sidecar.pid` so Stop and status survive a page reload. If the sidecar health endpoint already answers, start is a no-op success.
- `stopSidecarAction(): SimpleResult` reads the pid file and terminates the process, then removes the file.
- Status comes from the existing `getIgStatusAction` health read plus whether the tracked pid is alive.

A `SidecarControl` client component renders Start or Stop by state, with the live status row. It mounts inside the Instagram settings section.

Lifecycle caveat, documented in the UI and the code: the spawned sidecar is a child of the dev server. If the dev server is killed, the child may keep running (detached) or be reaped depending on the platform; the pid file plus a health check reconcile the real state on next load. This is acceptable for a local single-user tool.

### Instagram: session-token login

New server action `igLoginBySessionAction(sessionid: string): LoginResult` in `src/server/actions/ig-actions.ts`. It stores the value with `setSecret("IG_SESSIONID", ...)` and posts `{ sessionid }` to the sidecar `POST /login-by-session` through the existing ig client, mapping errors the same way the other ig actions do.

The Instagram settings section gains a "Sign in with a session token" panel, presented above the password flow and labeled recommended. It has a masked input for the `sessionid`, a short inline how-to (open instagram.com logged in, DevTools, Application, Cookies, copy the `sessionid` value), and a Connect button calling `igLoginBySessionAction`. The existing username, password, 2FA, and challenge flow stays as a fallback below it.

## Tasks and dependencies

1. Secrets store and config change (foundation): the table and migration, `store.ts`, `getOrCreateServiceToken`, and making `IG_SERVICE_TOKEN` optional in config.ts. Everything else depends on this.
2. Route consumers through the store: llm/client, graph/client, groq, ig/client, and the ingest route read `getSecret`/`getOrCreateServiceToken`. Depends on task 1.
3. Secrets settings panel and its actions: `secrets-actions.ts` and the rebuilt panel. Depends on task 1.
4. Sidecar control: `sidecar-actions.ts`, the `SidecarControl` component, and its status wiring. Depends on task 1.
5. Session-token login: `igLoginBySessionAction` and the session panel in the Instagram section. Depends on task 1.

Tasks 2 through 5 are independent of each other (disjoint files) and can run in parallel after task 1. Tasks 4 and 5 both touch the Instagram settings section; task 4 adds a `SidecarControl` child component and task 5 adds a session panel, so they edit `instagram-section.tsx` in different places. Coordinate the merge or keep each change in its own child component to avoid a conflict.

## Testing

- Store: get reads db over env, env fallback, clear removes the db row (env still shows), status never returns values, `getOrCreateServiceToken` generates once and is stable across calls, empty value rejected.
- config.ts: a missing `IG_SERVICE_TOKEN` no longer throws at load.
- Consumers: with a db-set `ANTHROPIC_API_KEY` and no env, `hasApiKey` is true; same for Graph and Groq; the ingest route accepts a token that matches `getOrCreateServiceToken`.
- Secrets actions: set rejects an unknown name, set then status shows configured from db, clear then status reflects the env fallback, values never appear in a response.
- Sidecar actions: start writes a pid file and injects the expected env keys (spawn mocked), stop removes the pid file, start is a no-op when health already answers (mocked).
- Session login: `igLoginBySessionAction` stores the sessionid and calls the sidecar endpoint (ig client mocked), maps a sidecar error to a typed failure.

## Open questions

None.
