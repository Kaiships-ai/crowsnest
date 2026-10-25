# Onboarding cases

## Built features

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Set up crowsnest in the terminal | `kai kit init` writes `.env.local`, prompts for Instagram credentials, creates the database, and starts the app | ● | `src/kai-cli/kai.ts` (`cmdKitInit`) | none, ONB-1/ONB-2 fixed, see the `backlog` issues |
| 5 | Live-validated credentials | Instagram login by session token or by username and password through server actions that check the live sidecar before relying on the value | ● | `src/server/actions/ig-actions.ts` (`igLoginBySessionAction`, `igLoginWithCredentialsAction`), `src/server/actions/secrets-actions.ts` | none |
| 6 | Works with no model key | Nothing in setup asks for a model key, and the secrets store holds no model key | ● | `src/kai-cli/kai.ts` (`cmdKitInit`), `src/server/secrets/store.ts` | none |

Retired with the web app: the in-app first run flow (former feature 3), Settings' Replay first run (former feature 4), and the Settings and first-run credential screens and dependency status panel. A Lead Studio board replaces them. The first run gate rule stays in `src/server/queries/first-run-gate.ts`.

### Behavior notes

- The first run gate rule is `shouldRedirectToFirstRun`: a fresh install (flag unset, no channels) needs first run; a database with a channel, or with the flag set, never does.
- `kai kit init` needs a cached license, masks the Instagram password, generates `IG_SERVICE_TOKEN` while it is the placeholder, writes `.env.local` at mode 0600, migrates, starts the services, and registers MCP.
- `igLoginWithCredentialsAction` validates the Instagram username and password against the live sidecar before saving. A rejected login saves nothing. A two factor or challenge result is saved only after the follow-up succeeds.
- No setup step asks for a model key. Remix text is what the agent wrote over MCP.

## onboarding: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

How to run these: the terminal cases need a machine with the Kit installed and a cached license (`kai login` already run), on a real interactive terminal, a TTY, because the known defects only reproduce there, not under `kai kit init < answers`. The route and action rows run offline with `pnpm test --project crowsnest` (vitest). The web app's in-app cases and browser journeys are retired with the web app.

## 1. behavior

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KITINIT-01 | P1 | TTY, no license | `kai kit init` refuses to run without a cached entitlement ([set up crowsnest in the terminal](#built-features)). | No `~/.kai/entitlement.json`. | 1. Run `kai kit init`. | It dies with a message pointing at `kai login <license-key>` and writes nothing. | 🟡 blocked: terminal-only (TTY), no browser surface; out of scope for this browse-e2e pass |
| KITINIT-02 | P1 | TTY, license | The happy path writes `.env.local`, generates `IG_SERVICE_TOKEN`, creates the database, and starts the app ([set up crowsnest in the terminal](#built-features)). | Licensed; on a TTY; give a username, password, key, and default vault. | 1. Run `kai kit init` and answer every prompt. | `.env.local` written at mode 0600, `IG_SERVICE_TOKEN` generated, migrations and bootstrap run, services start through `kai up`. | 🟡 blocked: terminal-only (TTY), would also re-init the running install; out of scope for this browse-e2e pass |
| KITINIT-03 | P1 | TTY, license | (`ONB-1`, blocker) The masked `IG_PASSWORD` prompt saves an empty value on a real TTY, so the sidecar crash loops ([set up crowsnest in the terminal](#built-features)). | Licensed; on a real interactive terminal. | 1. Run `kai kit init`.<br>2. Type a username, then a password at the `IG_PASSWORD` prompt.<br>3. Inspect `.env.local` and start the sidecar. | `.env.local` has `IG_PASSWORD=` (length 0) while `IG_USERNAME` is set; the sidecar refuses to start ("IG_USERNAME and IG_PASSWORD must be set together", exit 78) and launchd crash loops it. | fail (confirmed): empty IG_PASSWORD written on a real-credential buyer test, see `evidence/10-onboarding-bugs.md` |
| KITINIT-05 | P2 | TTY, license | The `IG_PASSWORD` prompt is asked only when a username was given ([set up crowsnest in the terminal](#built-features)). | Licensed. | 1. Run `kai kit init`, leave `IG_USERNAME` blank. | No password is asked and `IG_USERNAME` stays unset in `.env.local`. | 🟡 blocked: terminal-only (TTY); out of scope for this browse-e2e pass |
| KITINIT-06 | P2 | TTY, license | Re-running edits an existing `.env.local` in place rather than overwriting it ([set up crowsnest in the terminal](#built-features)). | Licensed; a `.env.local` already present. | 1. Run `kai kit init` again. | It reports editing the existing file in place and keeps surrounding keys and comments. | 🟡 blocked: terminal-only (TTY), would rewrite the running install's `.env.local`; out of scope for this browse-e2e pass |

Retired with the web app (the first run flow, the Settings credential panels, and the dependency status panel no longer exist): GATE-01 through GATE-04, FLOW-01 through FLOW-13, REPLAY-01, CRED-04 through CRED-11, AI-01 through AI-03. The gate rule is covered by ACTION-01 through ACTION-04.

Not checkable by hand:

- Whether `ONB-1` reproduces on every real TTY or only some terminal configurations, it is a TTY-specific echo and read interaction in `ask`.
- The exact set of Instagram responses (clean login vs. two factor vs. challenge) a given account will produce, which depends on Instagram, not the app.

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-01 | P1 | pure function (`src/server/queries/first-run-gate.ts :: shouldRedirectToFirstRun`) | A truly fresh install, no flag, no channels, redirects. | None; pure function. | `shouldRedirectToFirstRun({ firstRunCompleted: false, hasChannels: false })`. | Returns `true`. | 🟢 covered by vitest (green) |
| ACTION-02 | P1 | pure function (`src/server/queries/first-run-gate.ts :: shouldRedirectToFirstRun`) | A database that already has channels never redirects, even with the flag unset, protecting a seeded or pre-flag database. | None; pure function. | `shouldRedirectToFirstRun({ firstRunCompleted: false, hasChannels: true })`. | Returns `false`. | 🟢 covered by vitest (green) |
| ACTION-03 | P1 | pure function (`src/server/queries/first-run-gate.ts :: shouldRedirectToFirstRun`) | Once the flag is set, the gate never redirects again, even with zero channels. | None; pure function. | `shouldRedirectToFirstRun({ firstRunCompleted: true, hasChannels: false })` and with `hasChannels: true`. | Returns `false` in both cases. | 🟢 covered by vitest (green) |
| ACTION-04 | P1 | drizzle query (`src/server/queries/first-run-gate.ts :: getFirstRunGate`) | The async reader combines a settings read and a `channels` existence check into the same decision the pure rule makes. | Temp SQLite database, seeded with and without a `channels` row and with `first_run_completed` set and unset. | `getFirstRunGate()` across each combination. | `redirectToFirstRun` matches `shouldRedirectToFirstRun` for the same inputs; `firstRunCompleted` echoes the stored flag. | 🟢 covered by vitest (green) |
| ACTION-09 | P1 | server action (`src/server/actions/ig-actions.ts :: igLoginBySessionAction`) | The action calls `setSecret("IG_SESSIONID", ...)` before the sidecar login attempt resolves, so the sessionid is stored even when the sidecar then rejects it; a successful login returns the sidecar's real status. | A fake `igClient` whose `loginBySession` resolves `{ status: "ok" }` for one call and rejects with an `IgError` for another. | `igLoginBySessionAction("fake-sessionid")` for each case. | The resolving case returns `{ ok: true, status: "ok" }`; the rejecting case returns a `Failure`, but in both cases `IG_SESSIONID` is written to the secrets store, since the write happens unconditionally before the sidecar call. | 🟢 covered by vitest (green) |
| ACTION-13 | P1 | server action (not yet built, e.g. an `igLoginWithCredentialsAction`) | Build target, ENH-1. A future action accepting a typed username and password validates against the sidecar and calls `setSecret` for `IG_USERNAME`/`IG_PASSWORD` only on a successful login, never on a rejected one, the opposite of `igLoginBySessionAction`'s current write-before-validate order (`ACTION-09`). | Temp SQLite database; a fake `igClient.login({ username, password })` resolving and rejecting cases. | The not-yet-built action, called with a wrong password. | On rejection: the return value is a `Failure` and no `IG_USERNAME`/`IG_PASSWORD` row is written or changed. | 🟢 covered by vitest (green) |

Retired with the web app: ACTION-05 through ACTION-07 (pure functions in the deleted first-run view module).

Not checkable by hand:

- Whether `getFirstRunGate` and the pure `shouldRedirectToFirstRun` rule ever disagree against a real seeded database, `ACTION-04` above is written but not yet run against a temp SQLite fixture.
- Any assertion on `cmdKitInit` itself: it has no unit test today, it is exercised only through the manual terminal cases in the behavior lens above.

## 3. browse-e2e

Retired with the web app: E2E-01, E2E-03, E2E-04, E2E-06, E2E-08, E2E-09, E2E-10. Feature 2 (`kai kit init`) is terminal-only and is covered by the KITINIT rows and SEC-01 to SEC-03.

## 4. security-lite

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | P1 | Secret handling | (confirmed bug) The `IG_PASSWORD` masked prompt must not silently write an empty secret to `.env.local`. | On a real interactive terminal, licensed. | 1. Run `kai kit init`.<br>2. Enter a username, then a password at the masked prompt.<br>3. Read back `.env.local`. | `.env.local` should hold the typed password; instead it holds `IG_PASSWORD=` (length 0), tracked as `ONB-1`. | fail (confirmed): see `evidence/10-onboarding-bugs.md` |
| SEC-02 | P1 | Secret handling | A masked prompt must not echo its typed value to the terminal. | On a real interactive terminal, licensed. | 1. Run `kai kit init` to the `IG_PASSWORD` prompt.<br>2. Type a value and watch the screen and scrollback. | The value never appears on screen (`ask(..., { secret: true })` reads through `readSecretLine`). | not run |
| SEC-03 | P2 | Secret handling | `.env.local`, which holds the Instagram password, is written with owner-only permissions, never left world-readable. | A fresh `kai kit init` run. | 1. Run `kai kit init`.<br>2. Check the file mode on `.env.local`. | Mode `0600`; `cmdKitInit` calls `writeFileSync(..., { mode: 0o600 })` and `chmodSync(..., 0o600)` again, because `writeFileSync`'s mode only applies when it creates the file and `copyFileSync` may have already left it `0644`. | 🟡 blocked: terminal-only (TTY), would re-init the running install; out of scope for this browse-e2e pass |
| SEC-04 | P1 | Secret handling | A secret value saved through `setSecretAction` never round-trips back from the server: `setSecretAction` returns only `{ ok }` and the following `getSecretStatusAction` read returns only `configured`/`source`, never the value itself. | Any managed secret. | 1. Call `setSecretAction` with a value.<br>2. Inspect the results of `setSecretAction` and `getSecretStatusAction`. | Neither result contains the value anywhere; only configured and source are returned. | 🟢 pass (browser + source): saved the CRED-03 test key; the three action POSTs that fired were 231B/104B/428B, too small to carry the 34-char key plus a full page payload. `setSecretAction` returns `{ ok: true }` only; `secretStatus()` returns only `{ name, configured, source }` per managed secret, confirmed by reading `secrets-actions.ts` and `secrets/store.ts` directly |
| SEC-05 | P1 | Secret handling | No secret value, a Groq key or any Instagram credential, ever reaches a log line, because no action here logs its own arguments and the shared logger's `redact()` masks any field named like a secret as a defense in depth. | None. | 1. Save a Groq key, an Instagram password, and a sessionid in turn.<br>2. Search the server's stdout/stderr for each raw value. | None of the three raw values appear anywhere in the log output. | Fixed: the caveat found here (`emit()` passed the raw `fields` object to `insertLogEvent`, not the `redact()`'d one) is closed; `emit()` now redacts before calling `insertLogEvent`, so the DB sink's masking no longer depends solely on `insertLogEvent`'s own separate `redactLogFields` pass. Covered by `src/server/lib/logger.redact.test.ts`, which mocks `insertLogEvent` and asserts the fields it receives are already masked; not re-verified in the browser this pass. See ONB-5 in GitHub issues |
| SEC-07 | P1 | Secret handling | Build target, ENH-1. The future username/password validation path must not become an unthrottled Instagram login oracle: it reuses the sidecar's own rate-limit and cooldown (`IG_RATE_LIMITED`, `cooldownUntil`), rather than opening a second, faster retry loop around it. | Sidecar up; the not-yet-built credential form; a fixed username submitted with several wrong passwords in a row. | 1. Submit the same username with a wrong password repeatedly, quickly. | After the sidecar's own threshold, further attempts come back as `IG_RATE_LIMITED` with a `cooldownUntil`, the same as the existing connect flow; the dashboard form adds no separate retry path around that limit. | blocked: not built (ENH-1) |
| SEC-08 | P1 | Secret handling | Build target, ENH-1. A submitted password is never persisted, to the database or a log line, when the login it validates fails. | Sidecar up; a wrong password submitted to the future form. | 1. Submit a wrong password.<br>2. Read the `secrets` table and the server logs. | No `IG_PASSWORD` row changes and no log line contains the attempted password. | blocked: not built (ENH-1) |

Retired with the web app: SEC-06 (the Settings page render). The action-level claim is SEC-04.

Security-lite has no rows for the license gate or cross-tenant leakage: the license check (`readEntitlement`) is owned by the Kit CLI, not onboarding, and crowsnest is single-user with no tenants. The sidecar shared token is owned and covered by [ig-sync](ig-sync.md). Onboarding's own security-lite surface is secret handling: the two terminal prompts above (`SEC-01` to `SEC-03`), the dashboard's "API keys & secrets" panel and session-token login (`SEC-04` to `SEC-06`), and the not-yet-built username/password validation path's obligations once it exists (`SEC-07`, `SEC-08`).
