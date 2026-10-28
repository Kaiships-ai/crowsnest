# Connectors and keychain secrets

Each outside source is a connector: a manifest (id, label, auth kind, the secrets it needs, the ledger counts it feeds) plus an adapter (test connection, pull). `src/server/connectors/registry.ts` finds every folder under `src/server/connectors/` on its own. Secrets are sealed by the macOS Keychain through Orca's `SecretStore`; on boot a legacy plaintext `secrets` row moves to `sealed_secrets`. Architecture: `documents/architecture/connectors.md`.

## Sub-features

- Bridge `listConnectors`: every connector, its status (`configured`, `needs-setup`, `not-connected`) and where each secret comes from (`keychain`, `db`, `env`, `none`), never a value.
- Bridge `testConnector(id)`: the adapter's connection check, recorded in `connector_status`; a manifest-only connector answers not connected. Bridge `pullConnector(id)`: the adapter's pull, recorded the same way; the card has no Pull button, so agents and journeys call it through the bridge. Each card shows one state (`ready`, `partial`, `error`, or `not-connected` when setup is missing): a failed check's error, else the last pull's outcome, which stays until the next pull, with its message and a "Details: ..." line. A passing check never clears a pull's error or partial. A sync scoped to some channels is not recorded, and a pull that loses to a running sync fails with "A sync is already running" and records nothing. It survives a restart. While a Re-check runs, the card alone reads Checking.
- IG sidecar (`ig-sidecar`): every secret is optional, so the card is always configured. Re-check calls the sidecar's `/health`; its pull runs the channel sync (`/profile`, `/medias`, `/media-stats`, `/download`). Saving the "Browser session id" (`IG_SESSIONID`) calls `igLoginBySessionAction`, so the sidecar adopts it (`POST /login-by-session`); a refusal keeps the dialog open with the reason.
- Boot migration: legacy rows move to the keychain, a failed move keeps the row and logs `secrets.keychain_move_failed`.
- Umami: four secrets (`UMAMI_URL`, `UMAMI_WEBSITE_ID`, `UMAMI_USERNAME`, `UMAMI_PASSWORD`) entered in Settings > Sources, Re-check logs in and finds the website, a pull stores each VN day in `umami_days` and each plan keyword's `visits` and `emails` in `reel_funnel`, which Funnel's gift-page step and My channel's Site column read. A partial pull stores nothing.

## How to get to it (user POV)

Settings > Sources shows it: the sidebar's Sources row, or Settings, Sources. Cards are `source-card` (`data-connector-id`, `data-state`) in `source-group`s, with `source-primary` (Connect or Edit key), `source-explanation`, `source-pulls`, `source-recheck` and `source-detail`, and no Pull button; the key dialog is `source-key-dialog` with `source-key-input` (`data-secret-name`) and `source-key-save`.

`sources-01` (on `boards-lane.sh`) prints `ok: the sidebar's Sources opens Settings > Sources with every connector, grouped like Integrations` (card ids match `listConnectors`), `ok: no card has a Pull button: a card only checks, the pull lives elsewhere` (it prints each card's buttons), `ok: Connect saves a fake key, closes, and the key reads only as saved`, `ok: no bridge read carries the saved value` (it also calls `setConnectorSecret` with a field Polar does not declare and is refused), `ok: the lane DB holds the key sealed, never in plaintext`, `ok: Re-check shows the connection check`, and saves `sources-01-dark`, `sources-01-light`, `sources-01-saved` and `sources-01`.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh connectors-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
.claude/skills/verify/scripts/keychain-lane.sh   # real login Keychain, lane-only item, deleted after
```

`umami-01` runs on `boards-lane.sh`, which also starts `fake-umami.mjs` (login `lane-umami` / `lane-umami-pass`, website `lane-site`, events in pages of 3 spread over the asked window: four `own01` sessions, one of them `utm_source=verify`, and one with no utm; `POST /__fail?page=N` makes page N answer 503). Run it after `own-01`, which expects the seed's 18 visits. It prints `ok: Sources: Connect saves the four Umami fields and the card leaves Not configured`, `ok: Re-check logs in to Umami and finds the website`, `ok: a pull reads every page, the card reads Ready, and the lane DB holds the day and OWN01's 4 visits and 2 emails` (`umami_days` shows 1 test session dropped, clean 4 and raw 5), `ok: Funnel: the gift-page step and OWN01's row show the pulled visits`, `ok: My channel: the Site column of the OWN01 reel shows 4`, `ok: a 503 on events page 2 makes the pull read Partial, and nothing new is stored`, and saves `umami-01-sources`, `umami-01-funnel`, `umami-01-own` and `umami-01-partial`.

```bash
.claude/skills/verify/scripts/boards-lane.sh
.claude/skills/verify/scripts/app-drive.sh umami-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
```

`connectors-01` prints `ok: the bridge lists every connector with its state` (Polar and ChatbotX `not-connected`, Umami `needs-setup` or `configured`), `ok: the seeded Graph token moved to the keychain on boot and no value crosses the bridge`, `ok: the lane DB holds no plaintext secret`, `ok: a manifest-only connector is never called`, and saves `connectors-01.png`. It reads the lane DB with `sqlite3` from the user data dir `app-up.sh` printed.

`sidecar-session-01` and `sidecar-expired-01` run on `boards-lane.sh` (`run-all.sh` runs both). `fake-sidecar.mjs` logs every request with its body to `data/verify/app/fake-sidecar.log`, answers `POST /login-by-session` with `{"status":"ok"}`, and on `POST /__session?state=expired` answers every Instagram call with the body the real sidecar sends for an expired session (HTTP 401, `IG_AUTH_REQUIRED`, upstream `ClientError` `login_required`) until `state=ok`. Before the fix the real sidecar sent HTTP 503 `IG_NETWORK` for it; `classify` in `services/ig/crowsnest_ig/errors.py` now maps it, and `test_errors.py` pins that half. `sidecar-session-01` saves a Browser session id on the sidecar card and expects `POST /login-by-session` with it in the log. `sidecar-expired-01` expires the session, pulls the sidecar through the bridge, opens Sources, reads the `error` state, and expects the card to tell the user to log in again; it restores the session in a `finally`.

Known product gaps, so both fail today: saving the session id only stores the secret (nothing calls `igLoginBySessionAction`), and an expired session reads "Network failure" (the sidecar sends `IG_NETWORK`; the app's client also turns any sidecar 401, `IG_AUTH_REQUIRED` included, into `IG_SERVICE_UNAUTHORIZED`). When the sidecar learns to send `IG_AUTH_REQUIRED` for `login_required`, change the fake's expired body to match.

```bash
.claude/skills/verify/scripts/boards-lane.sh
.claude/skills/verify/scripts/app-drive.sh sidecar-session-01 [run-id]
.claude/skills/verify/scripts/app-drive.sh sidecar-expired-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
```

## Gotchas

- The lane runs Electron with `--use-mock-keychain`, so the seal there never touches the login Keychain. The real-Keychain proof is `keychain-lane.sh`: it bundles `src/server/secrets/store.ts` into an Electron main named `lead-studio-lane-<pid>`, migrates a legacy row on a throwaway DB in the gitignored verify data folder, checks the `.dump` holds no plaintext, and deletes the `lead-studio-lane-<pid> Safe Storage` item on exit. It refuses to run if that item already exists.
- The seed writes the Graph token as a legacy `secrets` row on purpose: the journey proves the boot migration moves it.
- Running `umami-01` before `own-01` on the same lane makes `own-01` fail: the pull replaces the seed's 18 OWN01 visits with 4.

## Card state across a restart

`card-state-lane.sh` starts `fake-sidecar.mjs`, seeds the app and runs `card-state-01`, then copies the lane DB with `sqlite3 .backup` to `data/verify/app/restart.db`, quits the app (`app-down.sh`), and reopens a new app on that copy (`APP_REAL_DB=... app-up.sh --real`) for `card-state-02`. `run-all.sh` runs it as its own lane. `card-state-01` prints `ok: Settings > Sources: no card names a next pull time or has a Pull button`, `ok: the sidecar's session expires and a pull fails: the card shows Error with its reason`, `ok: the session is back and Re-check passes: the failed pull still shows Error, a check proves the key and not the data` (one pill, the DB row `pull_state` `error`, no `check_message`, `checked_at` after `pulled_at`), `ok: a pull succeeds: the card shows only Ready, no Error and no Verified`, `ok: a pull fails again, leaving Error as the newest event for the restart`, and saves `card-state-01-error.png` and `card-state-01-ready.png`. `card-state-02` prints `ok: after the restart the sidecar card still shows the last pull's Error and its reason` and `ok: no check or pull ran on start: connector_status holds the same one row per event`, and saves `card-state-02-after-restart.png`. The fake sidecar answers `/health` as the real one does (logged in, no Instagram call), so a Re-check passes even while its session is set to expired. `POST /__medias?state=empty` makes it answer `/medias` with an empty last page, so `card-state-01`'s good pull completes; `state=refuse` restores the 503.
